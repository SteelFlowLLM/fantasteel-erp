import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AI_NOTION_CONTENT_MAX,
  AI_NOTION_EDIT_MAX,
  AI_NOTION_EDIT_TEXT_MAX,
  AI_NOTION_TITLE_MAX,
  type AiActionCardExecuteResult,
  type AiNotionCard,
  type AiNotionPageRef,
  type AiNotionTextEdit,
  type AuthUser,
} from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { hasStructuralTag, type NotionFetched } from '../../integration/notion/notion-assistant.tools';
import { NotionAssistantService } from '../../integration/notion/notion-assistant.service';
import { seoulIso } from '../../integration/notion/notion-workspace.tools';
import type { ExecuteAiActionCardDto } from '../dto/ai-assistant.dto';
import { optionalEnum, optionalString, requiredString, ToolArgumentError } from '../tools/assistant-tool';

export type ProposedNotionCard = AiNotionCard extends infer T ? (T extends unknown ? Omit<T, 'key'> : never) : never;

export const NOTION_ACTIONS = ['create', 'append', 'update'] as const;
const STRUCTURAL_TAG_MESSAGE = '하위 페이지·데이터베이스 태그(<page>·<database>·<data-source>)는 쓸 수 없어요. 다른 페이지는 링크로 가리켜요';
/** 한 번 실행한 카드 번호를 기억하는 시간. 화면 대화가 이보다 오래 남지 않는다 (가정값) */
const LEDGER_TTL_MS = 24 * 3_600_000;
const ALREADY_RUN_MESSAGE = '이 카드는 이미 실행했어요. Notion에서 결과를 확인해 주세요. 다시 쓰려면 철강맨AI에게 새로 부탁해 주세요';

/**
 * 같은 카드를 두 번 실행하지 않게 카드 번호(nonce)를 기억한다. 서버 메모리라 서버를 다시 띄우면 잊는다(카드도 화면 대화에만 있다).
 * 확실히 쓰지 않은 실패(거절·범위 밖)는 풀어 다시 실행할 수 있게 하고, 썼는지 모르는 실패(INT-009)는 남긴다.
 */
export class NotionCardLedger {
  private readonly used = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  claim(nonce: string): boolean {
    const now = this.now();
    for (const [key, at] of this.used) if (now - at > LEDGER_TTL_MS) this.used.delete(key);
    if (this.used.has(nonce)) return false;
    this.used.set(nonce, now);
    return true;
  }

  release(nonce: string): void {
    this.used.delete(nonce);
  }
}

/** 카드 글 확인: 길이·하위 페이지 태그. 제안할 때는 모델에 이유를, 실행할 때는 COM-004로 알린다 */
export function notionTextProblem(text: string, max: number, label: string): string | null {
  if (text.length > max) return `${label}은(는) ${max}자까지예요`;
  if (hasStructuralTag(text)) return STRUCTURAL_TAG_MESSAGE;
  return null;
}

/** 모델이 넘긴 edits 배열 ({ old, new } 또는 { oldStr, newStr }) */
export function parseEdits(raw: unknown): AiNotionTextEdit[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ToolArgumentError('edits는 [{ "old": "…", "new": "…" }] 배열이에요');
  if (raw.length > AI_NOTION_EDIT_MAX) throw new ToolArgumentError(`edits는 ${AI_NOTION_EDIT_MAX}개까지예요`);
  return raw.map((item, index) => {
    const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    const oldStr = record.old ?? record.oldStr ?? record.old_str;
    const newStr = record.new ?? record.newStr ?? record.new_str;
    if (typeof oldStr !== 'string' || oldStr === '' || typeof newStr !== 'string') throw new ToolArgumentError(`edits[${index}]에 old(바꿀 글)와 new(새 글)가 필요해요`);
    // 바꿀 글(old)은 페이지에서 찾는 글이라 표 칸(<td>) 같은 마크업이 들어 있어도 된다. 새 글(new)만 하위 페이지 태그를 막는다
    if (oldStr.length > AI_NOTION_EDIT_TEXT_MAX) throw new ToolArgumentError(`edits[${index}].old는 ${AI_NOTION_EDIT_TEXT_MAX}자까지예요`);
    const problem = notionTextProblem(newStr, AI_NOTION_EDIT_TEXT_MAX, `edits[${index}].new`);
    if (problem) throw new ToolArgumentError(problem);
    return { oldStr, newStr };
  });
}

const refOf = (page: NotionFetched): AiNotionPageRef => ({ id: page.id, title: page.title || '(제목 없음)', url: page.url });

/** 공백 차이는 같은 글로 본다 (모델이 줄바꿈을 다르게 옮기기도 한다). 실제 바꾸기는 Notion이 정확히 맞는 글로 한다 */
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Notion은 쓴 사람을 회사 계정으로만 남기므로, 누가 부탁했는지 글 끝에 한 줄 남긴다 */
export function attributionLine(user: AuthUser, at: Date): string {
  return `*철강맨AI · ${user.employeeName} 요청 · ${seoulIso(at).slice(0, 16).replace('T', ' ')}*`;
}

/**
 * 철강맨AI의 Notion 실행 카드 (문서에 없는 기능, 2026-10-19 이슈 #398): 새 페이지, 페이지 끝에 더하기, 글 일부 바꾸기·제목 바꾸기.
 * 제안할 때와 실행할 때 모두 대상이 상위 페이지 아래인지(ERP가 채우는 데이터베이스가 아닌지) Notion을 읽어 확인한다.
 * 쓰기는 사용자가 카드에서 [실행]을 눌렀을 때만 하고, 누가 실행했는지 서버 로그(AI 경유)와 글 끝 한 줄에 남긴다.
 * 작업 로그(business_event)는 남기지 않는다: Notion 쓰기에 맞는 작업 로그 종류가 공통 코드에 없다(🟡 정의서에 올릴지 확인).
 */
@Injectable()
export class AiNotionCardService {
  private readonly logger = new Logger(AiNotionCardService.name);
  private readonly ledger = new NotionCardLedger();

  constructor(private readonly notion: NotionAssistantService) {}

  async propose(user: AuthUser, args: Record<string, unknown>): Promise<ProposedNotionCard> {
    const action = optionalEnum(args, 'action', NOTION_ACTIONS);
    if (!action) throw new ToolArgumentError(`action은 ${NOTION_ACTIONS.join(', ')} 중 하나예요`);
    const pageArg = optionalString(args, 'page', 300) ?? null;
    const nonce = randomUUID();

    if (action === 'create') {
      const pageTitle = requiredString(args, 'title', AI_NOTION_TITLE_MAX);
      const content = requiredString(args, 'content', AI_NOTION_CONTENT_MAX);
      const problem = notionTextProblem(content, AI_NOTION_CONTENT_MAX, 'content');
      if (problem) throw new ToolArgumentError(problem);
      const parent = await this.target(pageArg);
      return { kind: 'NOTION_PAGE_CREATE', title: `Notion 새 페이지 · ${pageTitle}`, nonce, parent: refOf(parent), pageTitle, content, issues: [] };
    }

    if (pageArg === null) throw new ToolArgumentError('page(고칠 페이지 주소)가 필요해요. notion_search로 찾은 주소를 넘겨요');
    if (action === 'append') {
      const content = requiredString(args, 'content', AI_NOTION_CONTENT_MAX);
      const problem = notionTextProblem(content, AI_NOTION_CONTENT_MAX, 'content');
      if (problem) throw new ToolArgumentError(problem);
      const page = await this.target(pageArg);
      return { kind: 'NOTION_PAGE_APPEND', title: `Notion 글 더하기 · ${page.title || '(제목 없음)'}`, nonce, page: refOf(page), content, issues: [] };
    }

    const edits = parseEdits(args.edits).filter((edit) => edit.oldStr !== edit.newStr);
    const titleArg = optionalString(args, 'title', AI_NOTION_TITLE_MAX) ?? null;
    const page = await this.target(pageArg);
    const newTitle = titleArg !== null && titleArg !== page.title ? titleArg : null;
    if (edits.length === 0 && newTitle === null) throw new ToolArgumentError('바꿀 내용이 없어요. edits(old·new)나 바꿀 title을 넘겨요');
    const body = squash(page.body);
    const issues = edits.filter((edit) => !body.includes(squash(edit.oldStr))).map((edit) => `"${cut(edit.oldStr, 40)}"을(를) 페이지 글에서 찾지 못했어요. 읽은 글 그대로인지 확인해 주세요`);
    return { kind: 'NOTION_PAGE_UPDATE', title: `Notion 고치기 · ${page.title || '(제목 없음)'}`, nonce, page: refOf(page), newTitle, edits, issues };
  }

  /** 사용자가 확인·수정한 카드를 Notion에 쓴다. 같은 카드는 한 번만 */
  async execute(user: AuthUser, dto: ExecuteAiActionCardDto): Promise<AiActionCardExecuteResult> {
    const kind = dto.kind;
    if (kind !== 'NOTION_PAGE_CREATE' && kind !== 'NOTION_PAGE_APPEND' && kind !== 'NOTION_PAGE_UPDATE') throw new AppException('COM-004', '카드 종류가 올바르지 않아요');
    if (!dto.nonce || !dto.notionPageId) throw new AppException('ACT-001', '채워야 할 칸: 카드 번호, 대상 페이지');
    const write = this.writerFor(user, kind, dto);
    const nonce = dto.nonce;
    if (!this.ledger.claim(nonce)) throw new AppException('COM-001', ALREADY_RUN_MESSAGE);
    try {
      const outcome = await write(dto.notionPageId);
      this.logger.log(`철강맨AI Notion 쓰기(AI 경유) · ${kind} · 사원 ${user.employeeNo} ${user.employeeName} · ${outcome.url}`);
      return { kind, registered: { type: 'notion_page', id: 0, url: outcome.url, ...(outcome.note ? { note: outcome.note } : {}) } };
    } catch (error) {
      // 썼는지 모르는 실패만 번호를 남긴다 (다시 누르면 같은 글이 두 번 생길 수 있다)
      if (!(error instanceof AppException && error.code === 'INT-009')) this.ledger.release(nonce);
      throw error;
    }
  }

  /** 카드 칸을 확인하고 Notion에 쓸 함수를 돌려준다 (확인이 실패하면 번호를 잡지 않는다) */
  private writerFor(user: AuthUser, kind: AiNotionCard['kind'], dto: ExecuteAiActionCardDto) {
    const textProblem = (text: string, max: number, label: string) => {
      const problem = notionTextProblem(text, max, label);
      if (problem) throw new AppException('COM-004', problem);
    };
    if (kind === 'NOTION_PAGE_CREATE') {
      const pageTitle = dto.pageTitle?.trim();
      const content = dto.content?.trim();
      if (!pageTitle || !content) throw new AppException('ACT-001', `채워야 할 칸: ${[...(!pageTitle ? ['제목'] : []), ...(!content ? ['내용'] : [])].join(', ')}`);
      textProblem(content, AI_NOTION_CONTENT_MAX, '내용');
      return (parentId: string) => this.notion.createPage(parentId, { title: pageTitle, content: `${content}\n\n${attributionLine(user, new Date())}` });
    }
    if (kind === 'NOTION_PAGE_APPEND') {
      const content = dto.content?.trim();
      if (!content) throw new AppException('ACT-001', '채워야 할 칸: 내용');
      textProblem(content, AI_NOTION_CONTENT_MAX, '내용');
      return (pageId: string) => this.notion.appendContent(pageId, `${content}\n\n${attributionLine(user, new Date())}`);
    }
    const edits = (dto.edits ?? []).filter((edit) => edit.oldStr !== edit.newStr);
    for (const edit of edits) textProblem(edit.newStr, AI_NOTION_EDIT_TEXT_MAX, '새 글');
    const title = dto.pageTitle?.trim() || null;
    if (edits.length === 0 && title === null) throw new AppException('ACT-001', '바꿀 내용이 없어요');
    return (pageId: string) => this.notion.updatePage(pageId, { title, edits });
  }

  /** 대상을 읽어 확인한다. 안 되는 대상이면 그 이유를 모델에 돌려준다 */
  private async target(ref: string | null): Promise<NotionFetched> {
    try {
      return await this.notion.writableTarget(ref);
    } catch (error) {
      if (error instanceof AppException) throw new ToolArgumentError((error.getResponse() as { message: string }).message);
      throw error;
    }
  }
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
