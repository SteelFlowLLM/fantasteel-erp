import {
  AI_SCREEN_ACTION_TIMEOUT_MS,
  AI_SCREEN_MAX_ACTIONS,
  AI_SCREEN_RESULT_MAX,
  aiScreenBlockedWord,
  aiScreenPathAllowed,
  isAiScreenTool,
  type AiAssistantStreamEvent,
  type AiScreenActionResultInput,
  type AiScreenMapEntry,
  type AiScreenTool,
} from '@fantasteel/shared';
import { randomUUID } from 'node:crypto';
import { LlmAbortedError, type LlmToolCall, type LlmToolDefinition } from '../../llm/llm.client';
import { requiredString, ToolArgumentError } from '../tools/assistant-tool';

type UiActionEvent = Extract<AiAssistantStreamEvent, { type: 'ui_action' }>;

/** 막은 동작 뒤 모델에 주는 안내 (다시 시도하지 않고 사용자에게 넘기게) */
export const USER_MUST_PRESS = '이 버튼은 AI가 누르지 않아요. 사용자에게 무엇을 확인하고 이 버튼을 직접 눌러야 하는지 알리고, 같은 동작을 다시 시도하지 않아요';
const TIMEOUT_REASON = `화면이 ${AI_SCREEN_ACTION_TIMEOUT_MS / 1000}초 안에 답하지 않았어요`;
const FILL_MAX = 200;

const REF = { type: 'string', description: '가장 최근 화면 글의 번호 (예: r12)' };
const DEFINITIONS: LlmToolDefinition[] = [
  { name: 'ui_snapshot', description: '사용자가 보고 있는 ERP 화면의 버튼·링크·입력칸·표를 [r번호]와 함께 읽는다.', parameters: { type: 'object', properties: {} } },
  {
    name: 'ui_navigate',
    description: '[열 수 있는 화면]의 주소로 사용자 화면을 옮긴다. 결과는 옮긴 뒤의 화면 글이다.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: '[열 수 있는 화면]의 주소 그대로 (예: /sales-orders/new). ?쿼리는 붙여도 된다' } }, required: ['path'] },
  },
  {
    name: 'ui_click',
    description: '화면 글의 [r번호] 버튼·링크·탭을 누른다. 저장·등록·확정·승인·삭제처럼 데이터를 바꾸는 버튼은 막혀 있다.',
    parameters: { type: 'object', properties: { ref: REF }, required: ['ref'] },
  },
  {
    name: 'ui_fill',
    description: `화면 글의 [r번호] 입력칸에 값을 넣는다(${FILL_MAX}자까지). 저장하지 않는다.`,
    parameters: { type: 'object', properties: { ref: REF, value: { type: 'string', description: '넣을 값' } }, required: ['ref', 'value'] },
  },
  {
    name: 'ui_select',
    description: '화면 글의 [r번호] 고르기 칸(select)에서 보이는 글이나 값으로 하나를 고른다.',
    parameters: { type: 'object', properties: { ref: REF, value: { type: 'string', description: '고를 항목의 보이는 글' } }, required: ['ref', 'value'] },
  },
];

interface Pending {
  owner: number;
  settle(result: AiScreenActionResultInput): void;
}

/**
 * 화면 동작을 기다리는 자리 (서버 메모리). 답이 ui_action을 보내고, 묻는 사원의 브라우저가 결과를 보내면 그 자리가 끝난다.
 * 처음 온 결과만 쓰고, 시간이 지나면 오류 결과로 끝내고, 답을 멈추면(연결 끊김) 자리를 지운다.
 */
export class ScreenActionBroker {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly timeoutMs = AI_SCREEN_ACTION_TIMEOUT_MS) {}

  get size(): number {
    return this.pending.size;
  }

  /** 자리를 만들고 send(actionId)로 화면에 알린 뒤 결과를 기다린다. 멈추면 LlmAbortedError */
  request(owner: number, send: (actionId: string) => void, signal?: AbortSignal): Promise<AiScreenActionResultInput> {
    if (signal?.aborted) return Promise.reject(new LlmAbortedError());
    const actionId = randomUUID();
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        this.pending.delete(actionId);
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        finish();
        reject(new LlmAbortedError());
      };
      const timer = setTimeout(() => {
        finish();
        resolve({ ok: false, error: TIMEOUT_REASON });
      }, this.timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(actionId, {
        owner,
        settle: (result) => {
          finish();
          resolve(result);
        },
      });
      send(actionId);
    });
  }

  /** 화면이 보낸 결과. 없는 자리이거나 다른 사원의 것이면 false (이미 끝난 자리도 false: 처음 온 결과만 쓴다) */
  settle(owner: number, actionId: string, result: AiScreenActionResultInput): boolean {
    const slot = this.pending.get(actionId);
    if (!slot || slot.owner !== owner) return false;
    slot.settle(result);
    return true;
  }
}

/** 화면 글 줄 `[r12] button "검색"`에서 번호 → 이름. 이름 안의 따옴표는 \" */
export function snapshotLabels(text: string): Map<string, string> {
  const labels = new Map<string, string>();
  for (const match of text.matchAll(/^\[(r\d+)\] \S+ "((?:[^"\\]|\\.)*)"/gm)) labels.set(match[1], match[2].replace(/\\(.)/g, '$1'));
  return labels;
}

/** 화면 글은 사용자 화면의 데이터라 지시로 읽지 않게 감싼다 (안의 같은 태그는 깨 둔다) */
export function wrapScreenContent(text: string): string {
  const safe = text.slice(0, AI_SCREEN_RESULT_MAX).replace(/<\/?screen_content/gi, (tag) => tag.replace('<', '‹'));
  return `<screen_content>\n${safe}\n</screen_content>`;
}

const failure = (reason: string, extra: Record<string, string> = {}) => JSON.stringify({ 오류: reason, ...extra });

export interface ScreenSessionInput {
  owner: number;
  screens: readonly AiScreenMapEntry[];
  emit: (event: UiActionEvent) => void;
  signal?: AbortSignal;
}

/** 한 답의 화면 조작: 동작 수, 마지막 화면 글의 번호 → 이름 (서버 쪽에서도 막을 버튼을 본다) */
export class ScreenControlSession {
  private actions = 0;
  private labels = new Map<string, string>();

  constructor(
    private readonly broker: ScreenActionBroker,
    private readonly input: ScreenSessionInput,
  ) {}

  has(name: string): boolean {
    return isAiScreenTool(name);
  }

  async run(call: LlmToolCall): Promise<string> {
    if (!isAiScreenTool(call.name)) return failure(`없는 도구예요: ${call.name}`);
    let args: Record<string, string>;
    try {
      args = this.checkArgs(call.name, parseArgs(call.arguments));
    } catch (error) {
      if (error instanceof ToolArgumentError) return failure(error.message);
      throw error;
    }
    if (call.name === 'ui_click') {
      const label = this.labels.get(args.ref);
      const word = label === undefined ? null : aiScreenBlockedWord(label);
      if (word) return failure(`막았어요: '${label}' 버튼은 데이터를 바꿔요`, { 안내: USER_MUST_PRESS });
    }
    if (++this.actions > AI_SCREEN_MAX_ACTIONS) return failure(`이번 질문에서는 화면 조작을 ${AI_SCREEN_MAX_ACTIONS}번까지만 해요`, { 안내: '지금까지 한 것으로 답해요' });
    const tool: AiScreenTool = call.name;
    const result = await this.broker.request(this.input.owner, (actionId) => this.input.emit({ type: 'ui_action', actionId, tool, args }), this.input.signal);
    if (!result.ok) return failure(result.error?.trim() || '화면에서 하지 못했어요', result.error?.startsWith('막았어요') ? { 안내: USER_MUST_PRESS } : {});
    const text = result.result ?? '';
    const labels = snapshotLabels(text);
    if (labels.size) this.labels = labels;
    return wrapScreenContent(text || '했어요');
  }

  private checkArgs(tool: AiScreenTool, args: Record<string, unknown>): Record<string, string> {
    switch (tool) {
      case 'ui_snapshot':
        return {};
      case 'ui_navigate': {
        const path = requiredString(args, 'path', 300);
        if (!aiScreenPathAllowed(path, this.input.screens)) throw new ToolArgumentError(`열 수 있는 화면이 아니에요: ${path}. [열 수 있는 화면]의 주소만 써요`);
        return { path };
      }
      case 'ui_click':
        return { ref: refOf(args) };
      case 'ui_fill':
      case 'ui_select': {
        const value = args.value;
        if (typeof value !== 'string') throw new ToolArgumentError('value는 문자열이어야 해요');
        if (value.length > FILL_MAX) throw new ToolArgumentError(`value는 ${FILL_MAX}자까지예요`);
        return { ref: refOf(args), value };
      }
    }
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    throw new ToolArgumentError('인자가 JSON이 아니에요');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new ToolArgumentError('인자는 객체여야 해요');
  return parsed as Record<string, unknown>;
}

function refOf(args: Record<string, unknown>): string {
  const ref = requiredString(args, 'ref', 12).replace(/^\[|\]$/g, '');
  if (!/^r\d{1,6}$/.test(ref)) throw new ToolArgumentError('ref는 화면 글의 번호예요 (예: r12)');
  return ref;
}

/**
 * ERP 화면 조작 도구 모음 (이슈 #382, 시험 중). AI_SCREEN_CONTROL_ENABLED=true이고 화면 조작을 켠 실시간 답에서만 알린다.
 * 동작은 사용자의 브라우저가 하고, 데이터를 바꾸는 버튼은 화면과 서버가 함께 막는다.
 */
export class AssistantScreenToolbox {
  constructor(
    readonly broker: ScreenActionBroker,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  capabilities(): { available: boolean } {
    return { available: this.env.AI_SCREEN_CONTROL_ENABLED?.trim().toLowerCase() === 'true' };
  }

  definitions(): LlmToolDefinition[] {
    return DEFINITIONS;
  }

  session(input: ScreenSessionInput): ScreenControlSession {
    return new ScreenControlSession(this.broker, input);
  }
}
