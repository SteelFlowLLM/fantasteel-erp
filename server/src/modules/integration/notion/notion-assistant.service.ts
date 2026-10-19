import { Injectable, Logger } from '@nestjs/common';
import { INTEGRATION_PROVIDER, NOTION_WORKSPACE_DATABASES, type AiNotionCapabilities, type IntegrationSettings } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationConnectionRepository } from '../integration-connection.repository';
import { readSettings } from '../integration-settings';
import { isAuthFailure, isRejectedBeforeRun, McpClientService, type McpSession, type McpToolInfo } from '../mcp/mcp.client';
import {
  buildAppendArgs,
  buildEditArgs,
  buildFetchArgs,
  buildQueryRowsArgs,
  buildRenameArgs,
  buildSearchArgs,
  notionIdOf,
  notionScopeOf,
  NOTION_QUERY_DATA_SOURCES_TOOL,
  NOTION_SEARCH_TOOL,
  readFetched,
  readRowsText,
  readSearchHits,
  readWriteResult,
  type MirroredNotionIds,
  type NotionFetched,
  type NotionScope,
  type NotionSearchHit,
} from './notion-assistant.tools';
import { buildCreatePageArgs, NOTION_CREATE_PAGES_TOOL, readCreatedPageUrl } from './notion.tools';
import { NOTION_FETCH_TOOL, NOTION_UPDATE_PAGE_TOOL } from './notion-workspace.tools';

export const NOTION_NOT_CONNECTED_REASON = 'Notion이 연결되어 있지 않아요. 관리자가 먼저 연결해 주세요';
export const NOTION_NO_PARENT_REASON = '관리자가 Notion 상위 페이지를 정하지 않았어요';
export const NOTION_OUTSIDE_MESSAGE = '회사 Notion 작업 공간(관리자가 정한 상위 페이지) 밖의 페이지라 읽거나 고칠 수 없어요';
export const NOTION_UNKNOWN_SCOPE_MESSAGE = 'Notion 페이지가 상위 페이지 아래인지 확인하지 못해 고치지 않았어요';
export const NOTION_MIRRORED_MESSAGE =
  'ERP가 자동으로 채우는 일정·회의록·할 일 데이터베이스예요. Notion에서 고치면 다음 반영 때 덮어써지니, ERP의 일정·업무를 바꿔 주세요 (일정·업무 고치기 카드)';
const NOT_A_PAGE_MESSAGE = '데이터베이스가 아니라 일반 페이지에만 쓸 수 있어요';
const UNCERTAIN_MESSAGE = 'Notion에 반영됐는지 확인하지 못했어요. Notion에서 페이지를 확인한 뒤, 반영되지 않았으면 새로 요청해 주세요';

interface NotionScopeContext {
  parentPageId: string;
  mirrored: MirroredNotionIds;
}

export interface NotionSearchOutcome {
  hits: NotionSearchHit[] | null;
  /** 결과 모양을 몰라 hits가 null일 때의 결과 글 */
  raw: string;
}

export interface NotionPageRead extends NotionFetched {
  scope: NotionScope;
  /** 데이터베이스면 행 조회 결과 글 (읽지 못하면 null) */
  rows: string | null;
}

export interface NotionWriteOutcome {
  url: string;
  /** Notion이 성공과 함께 알린 경고 */
  note: string | null;
}

/** settings.notionWorkspace의 세 데이터베이스 id (데이터베이스·데이터 소스) */
export function mirroredIdsOf(settings: IntegrationSettings): MirroredNotionIds {
  const databaseIds: string[] = [];
  const dataSourceIds: string[] = [];
  for (const key of NOTION_WORKSPACE_DATABASES) {
    const ref = settings.notionWorkspace?.[key];
    if (!ref) continue;
    const ds = notionIdOf(`collection://${ref.dataSourceId}`);
    if (ds) dataSourceIds.push(ds);
    for (const value of [ref.databaseId, ref.url]) {
      const id = value ? notionIdOf(value) : null;
      if (id) databaseIds.push(id);
    }
  }
  return { databaseIds, dataSourceIds };
}

/**
 * 철강맨AI가 회사 Notion을 읽고 쓰는 곳 (문서에 없는 기능, 2026-10-19 이슈 #398). 모든 사원이 쓰지만 대상은 관리자가 정한 상위 페이지 아래만이다:
 * 검색은 그 아래로 좁히고, 읽기·쓰기는 대상의 조상 경로를 읽어 확인한다. ERP가 채우는 세 데이터베이스(이슈 #391)와 그 행은 쓰지 않는다.
 * LLM에 Notion 도구를 넘기지 않고 서버 코드가 정한 도구만 부른다. 쓰기는 사용자가 실행 카드를 실행했을 때만 불린다.
 */
@Injectable()
export class NotionAssistantService {
  private readonly logger = new Logger(NotionAssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: IntegrationConnectionRepository,
    private readonly mcp: McpClientService,
  ) {}

  /** 화면의 Notion 칩을 켤 수 있는지 (연결과 상위 페이지만 본다. Notion을 부르지 않는다) */
  async availability(): Promise<AiNotionCapabilities> {
    const row = await this.repository.findByProviderKey(this.prisma, INTEGRATION_PROVIDER.NOTION);
    if (!row?.oauthTokens) return { available: false, reason: NOTION_NOT_CONNECTED_REASON };
    if (!readSettings(row.settings).parentPageId) return { available: false, reason: NOTION_NO_PARENT_REASON };
    return { available: true };
  }

  private async context(): Promise<NotionScopeContext> {
    const row = await this.repository.findByProviderKey(this.prisma, INTEGRATION_PROVIDER.NOTION);
    if (!row?.oauthTokens) {
      if (row?.connectedAt) throw new AppException('INT-003');
      throw new AppException('INT-002', NOTION_NOT_CONNECTED_REASON);
    }
    const settings = readSettings(row.settings);
    if (!settings.parentPageId) throw new AppException('INT-006');
    return { parentPageId: settings.parentPageId, mirrored: mirroredIdsOf(settings) };
  }

  /** 상위 페이지 아래에서 찾는다 */
  async search(query: string): Promise<NotionSearchOutcome> {
    const ctx = await this.context();
    return this.mcp.withSession(INTEGRATION_PROVIDER.NOTION, async (session) => {
      const tool = requireTool(await session.listTools(), NOTION_SEARCH_TOOL);
      const result = await session.callTool(tool.name, buildSearchArgs(tool, query, ctx.parentPageId));
      return { hits: readSearchHits(result), raw: result.content.flatMap((item) => (item.type === 'text' ? [item.text] : [])).join('\n') };
    });
  }

  /** 페이지·데이터베이스를 읽는다. 상위 페이지 밖이면 COM-002. ERP가 채우는 데이터베이스는 읽을 수 있다 */
  async read(ref: string): Promise<NotionPageRead> {
    const ctx = await this.context();
    const id = idOrThrow(ref);
    return this.mcp.withSession(INTEGRATION_PROVIDER.NOTION, async (session) => {
      const tools = await session.listTools();
      const fetched = await this.fetch(session, tools, id, ref);
      const scopes = scopesOf(fetched, id, ctx);
      if (scopes.includes('outside') || scopes.includes('unknown')) throw new AppException('COM-002', NOTION_OUTSIDE_MESSAGE);
      const scope: NotionScope = scopes.includes('mirrored') ? 'mirrored' : 'inside';
      let rows: string | null = null;
      const dataSourceId = fetched.kind === 'data_source' ? fetched.id : fetched.kind === 'database' ? fetched.dataSourceIds[0] : undefined;
      const queryTool = tools.find((t) => t.name === NOTION_QUERY_DATA_SOURCES_TOOL);
      if (dataSourceId && queryTool) {
        try {
          rows = readRowsText(await session.callTool(queryTool.name, buildQueryRowsArgs(queryTool, dataSourceId)));
        } catch (error) {
          // 행은 덧붙이는 정보라 서버가 입력을 거절해도 스키마만 돌려준다. 연결·인증 문제는 그대로 던진다
          if (!(error instanceof AppException) && !isRejectedBeforeRun(error)) throw error;
          if (isAuthFailure(error)) throw error;
        }
      }
      return { ...fetched, scope, rows };
    });
  }

  /**
   * 쓸 수 있는 대상인지 읽어 본다 (카드를 만들 때). ref가 없으면 상위 페이지. 상위 페이지 밖·ERP가 채우는 데이터베이스·데이터베이스 자체는 AppException.
   */
  async writableTarget(ref: string | null): Promise<NotionFetched> {
    const ctx = await this.context();
    const id = ref === null ? ctx.parentPageId : idOrThrow(ref);
    return this.mcp.withSession(INTEGRATION_PROVIDER.NOTION, async (session) => this.resolveWritable(session, await session.listTools(), ctx, id, ref ?? id));
  }

  /**
   * 대상 아래에 새 페이지를 만든다. 실행할 때 대상을 다시 확인한다(카드를 보여 준 뒤 옮겨졌을 수 있다).
   * 도구 호출이 실행 전에 거절된 것은 그대로, 결과를 알 수 없으면(시간 초과·주소 없는 성공) INT-009.
   */
  async createPage(parentId: string, page: { title: string; content: string }): Promise<NotionWriteOutcome> {
    const ctx = await this.context();
    return this.mcp.withSession(INTEGRATION_PROVIDER.NOTION, async (session) => {
      const tools = await session.listTools();
      const parent = await this.resolveWritable(session, tools, ctx, idOrThrow(parentId), parentId);
      const tool = requireTool(tools, NOTION_CREATE_PAGES_TOOL);
      const result = await this.callWrite(session, tool, buildCreatePageArgs(tool, parent.id, page));
      const url = readCreatedPageUrl(result);
      if (!url) {
        this.logger.warn('Notion 페이지 만들기 응답에 주소가 없음 (철강맨AI 카드)');
        throw new AppException('INT-009', UNCERTAIN_MESSAGE);
      }
      return { url, note: null };
    });
  }

  /** 페이지 끝에 글을 더한다 */
  async appendContent(pageId: string, content: string): Promise<NotionWriteOutcome> {
    const ctx = await this.context();
    return this.mcp.withSession(INTEGRATION_PROVIDER.NOTION, async (session) => {
      const tools = await session.listTools();
      const page = await this.resolveWritable(session, tools, ctx, idOrThrow(pageId), pageId);
      const tool = requireTool(tools, NOTION_UPDATE_PAGE_TOOL);
      const note = readWriteResult(await this.callWrite(session, tool, buildAppendArgs(tool, page.id, content)), '페이지에 글을 더하지 못했어요');
      return { url: page.url, note };
    });
  }

  /** 글 일부를 바꾸고(찾아 바꾸기) 제목을 바꾼다. 둘 다 있으면 글 먼저: 글 고치기가 거절되면 제목도 바꾸지 않는다 */
  async updatePage(pageId: string, change: { title: string | null; edits: readonly { oldStr: string; newStr: string }[] }): Promise<NotionWriteOutcome> {
    const ctx = await this.context();
    return this.mcp.withSession(INTEGRATION_PROVIDER.NOTION, async (session) => {
      const tools = await session.listTools();
      const page = await this.resolveWritable(session, tools, ctx, idOrThrow(pageId), pageId);
      const tool = requireTool(tools, NOTION_UPDATE_PAGE_TOOL);
      let note: string | null = null;
      if (change.edits.length > 0) note = readWriteResult(await this.callWrite(session, tool, buildEditArgs(tool, page.id, change.edits)), '페이지 글을 고치지 못했어요');
      if (change.title !== null) readWriteResult(await this.callWrite(session, tool, buildRenameArgs(tool, page.id, change.title)), '페이지 제목을 바꾸지 못했어요');
      return { url: page.url, note };
    });
  }

  private async fetch(session: McpSession, tools: McpToolInfo[], id: string, ref: string): Promise<NotionFetched> {
    const tool = requireTool(tools, NOTION_FETCH_TOOL);
    const isCollection = /^\s*collection:\/\//i.test(ref);
    return readFetched(await session.callTool(tool.name, buildFetchArgs(tool, id, isCollection ? 'collection' : 'page')), id);
  }

  private async resolveWritable(session: McpSession, tools: McpToolInfo[], ctx: NotionScopeContext, id: string, ref: string): Promise<NotionFetched> {
    const fetched = await this.fetch(session, tools, id, ref);
    const scopes = scopesOf(fetched, id, ctx);
    if (scopes.includes('mirrored')) throw new AppException('COM-004', NOTION_MIRRORED_MESSAGE, 409);
    if (scopes.includes('outside')) throw new AppException('COM-002', NOTION_OUTSIDE_MESSAGE);
    if (scopes.includes('unknown')) throw new AppException('COM-002', NOTION_UNKNOWN_SCOPE_MESSAGE);
    if (fetched.kind === 'database' || fetched.kind === 'data_source') throw new AppException('COM-004', NOT_A_PAGE_MESSAGE);
    return fetched;
  }

  /** 쓰기 도구를 부른다. 실행 전 거절은 그대로 던지고, 실행됐는지 모르는 실패는 INT-009 */
  private async callWrite(session: McpSession, tool: McpToolInfo, args: Record<string, unknown>) {
    try {
      return await session.callTool(tool.name, args);
    } catch (error) {
      if (isRejectedBeforeRun(error)) throw error;
      this.logger.warn(`Notion ${tool.name} 결과를 알 수 없음: ${error instanceof Error ? error.message : String(error)}`);
      throw new AppException('INT-009', UNCERTAIN_MESSAGE);
    }
  }
}

/** 결과가 다른 id를 가리켜도 요청한 대상과 결과 대상 둘 다 범위 안이어야 한다 */
function scopesOf(fetched: NotionFetched, requestedId: string, ctx: NotionScopeContext): NotionScope[] {
  return [
    notionScopeOf(fetched, ctx.parentPageId, ctx.mirrored),
    notionScopeOf({ id: requestedId, ancestors: fetched.id === requestedId ? fetched.ancestors : null }, ctx.parentPageId, ctx.mirrored),
  ];
}

function requireTool(tools: McpToolInfo[], name: string): McpToolInfo {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new AppException('INT-005', `Notion MCP 서버에 ${name} 도구가 없어요`);
  return tool;
}

function idOrThrow(ref: string): string {
  const id = notionIdOf(ref);
  if (!id) throw new AppException('COM-004', 'Notion 페이지 주소나 id가 아니에요. notion_search 결과의 주소를 그대로 넘겨 주세요');
  return id;
}
