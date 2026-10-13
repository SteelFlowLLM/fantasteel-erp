import { ROLE, type AuthUser } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import type { LlmClient, LlmEndpoint, LlmToolDefinition, LlmToolMessage, LlmToolReply } from '../llm/llm.client';
import { LlmRequestError } from '../llm/llm.client';
import type { LlmSettings, LlmSettingsStore } from '../llm/llm-settings.store';
import { AiAssistantService, MAX_TOOL_ROUNDS } from './ai-assistant.service';
import type { AssistantToolbox, ToolRunResult } from './tools/assistant-toolbox';
import { EMPTY_ANSWER, parseAssistantAnswer } from './assistant.answer';
import { buildAssistantMessages, MAX_HISTORY_TURNS } from './assistant.prompt';
import { GLOSSARY_TERMS } from './knowledge/glossary.generated';
import { GLOSSARY_SEARCH_LIMIT, searchGlossary } from './knowledge/glossary.search';

const termOf = (id: string) => {
  const term = GLOSSARY_TERMS.find((t) => t.id === id);
  if (!term) throw new Error(`${id} 없음`);
  return term;
};
const RESERVATION = termOf('TRM-056');
const ALLOCATION = termOf('TRM-060');
const ids = (text: string) => searchGlossary(text).map((t) => t.id);

describe('용어 사전 검색 (REQ-AST-003)', () => {
  it('질문에 있는 한글명을 찾는다', () => {
    expect(ids('예약과 배정은 뭐가 달라?')).toEqual(expect.arrayContaining(['TRM-056', 'TRM-060']));
  });

  it('띄어쓰기·대소문자가 달라도 찾고, 더 긴 이름을 앞에 둔다', () => {
    const found = ids('예약매수는 어떻게 세?');
    expect(found.indexOf('TRM-058')).toBeLessThan(found.indexOf('TRM-056'));
    expect(ids('fifo가 뭐야')).toContain('TRM-061');
  });

  it('사용 금지 동의어로 물어도 정식 용어를 찾는다 (괄호 안 설명은 검색어가 아니다)', () => {
    expect(ids('주문은 어떻게 넣어?')[0]).toBe('TRM-038');
    expect(ids('로트 번호는 어떻게 매겨?')).toContain('TRM-067');
  });

  it(`많이 맞아도 ${GLOSSARY_SEARCH_LIMIT}개까지만, 맞는 게 없으면 빈 목록`, () => {
    expect(searchGlossary('수주 예약 배정 출하요청 출고 확정 밀시트 LOT 히트 슬래브 코일')).toHaveLength(GLOSSARY_SEARCH_LIMIT);
    expect(searchGlossary('오늘 점심 뭐 먹지')).toEqual([]);
    expect(searchGlossary('   ')).toEqual([]);
  });
});

describe('답 정리와 출처 (REQ-AST-009)', () => {
  it('본문의 [TRM-…] 표시를 지우고 참고 자료 안의 용어만 출처로 둔다', () => {
    const parsed = parseAssistantAnswer('예약은 매수를 확보해요 [TRM-056]. 배정은 LOT을 지정해요 [TRM-060, TRM-999].', [RESERVATION, ALLOCATION]);
    expect(parsed.answer).toBe('예약은 매수를 확보해요. 배정은 LOT을 지정해요.');
    expect(parsed.sources).toEqual([
      { kind: 'GLOSSARY', id: 'TRM-056', label: '예약' },
      { kind: 'GLOSSARY', id: 'TRM-060', label: '배정' },
    ]);
  });

  it('ID를 빠뜨리면 본문에 이름이 나온 참고 용어를 출처로 둔다', () => {
    expect(parseAssistantAnswer('배정은 합격 LOT을 지정하는 거예요.', [RESERVATION, ALLOCATION]).sources.map((s) => s.id)).toEqual(['TRM-060']);
    expect(parseAssistantAnswer('용어 사전에서 확인할 수 없어요.', [RESERVATION]).sources).toEqual([]);
  });

  it('추론 모델의 <think> 부분은 보이지 않고, 답이 비면 다시 물어 달라고 한다', () => {
    expect(parseAssistantAnswer('<think>음…</think>\n예약은 매수 단위예요 (TRM-056)', [RESERVATION]).answer).toBe('예약은 매수 단위예요');
    expect(parseAssistantAnswer('<think>끝나지 않은 생각', [RESERVATION]).answer).toBe(EMPTY_ANSWER);
  });
});

describe('프롬프트 (REQ-AST-007·009)', () => {
  const base = {
    employeeName: '김영업',
    roleLabel: '영업',
    today: '2026-10-13',
    screen: { path: '/sales-orders?id=3', title: '수주 관리', label: null },
    references: [RESERVATION],
    history: [],
    question: '예약이 뭐야?',
  };

  it('시스템 지시에 안전 규칙·사용자·화면·참고 자료를 넣고, 질문을 마지막에 둔다', () => {
    const messages = buildAssistantMessages(base);
    const system = messages[0];
    expect(system.role).toBe('system');
    expect(system.content).toContain('지어내지 말고');
    // 지시문이 반말이면 작은 모델이 답에도 반말을 섞는다 (실제 모델 확인)
    expect(system.content).not.toMatch(/너는|어시스턴트야/);
    expect(system.content).toContain('직접 계산하지 않고');
    expect(system.content).toContain('김영업 · 역할 영업');
    expect(system.content).toContain('수주 관리 (/sales-orders?id=3)');
    expect(system.content).toContain('[TRM-056] 예약 (Reservation)');
    expect(system.content).toContain('사용 금지 동의어: 할당, 선점, Allocation');
    expect(messages.at(-1)).toEqual({ role: 'user', content: '예약이 뭐야?' });
  });

  it(`지난 대화는 최근 ${MAX_HISTORY_TURNS}개만 순서대로 넣는다`, () => {
    const history = Array.from({ length: MAX_HISTORY_TURNS + 4 }, (_, i) => ({ role: i % 2 ? ('assistant' as const) : ('user' as const), content: `말 ${i}` }));
    const messages = buildAssistantMessages({ ...base, history });
    expect(messages).toHaveLength(MAX_HISTORY_TURNS + 2);
    expect(messages[1].content).toBe('말 4');
  });

  it('찾은 용어가 없으면 없다고 알린다', () => {
    expect(buildAssistantMessages({ ...base, references: [], screen: null }).at(0)?.content).toContain('질문에 맞는 용어를 찾지 못했어요');
  });
});

describe('AiAssistantService', () => {
  const user: AuthUser = {
    employeeId: 1,
    employeeNo: '2103003',
    employeeName: '김영업',
    roleCode: ROLE.SALES,
    departmentId: 1,
    jobGradeId: 1,
    headDepartmentIds: [],
    permissions: {},
  };
  const TOOL: LlmToolDefinition = { name: 'get_inventory', description: '재고', parameters: { type: 'object' } };
  const answer = (content: string): LlmToolReply => ({ content, toolCalls: [] });
  const callTool = (id: string): LlmToolReply => ({ content: '', toolCalls: [{ id, name: 'get_inventory', arguments: '{"keyword":"SS275"}' }] });

  interface LlmCall {
    messages: LlmToolMessage[];
    tools: LlmToolDefinition[];
  }

  function setup(settings: Partial<LlmSettings>, replies: (call: LlmCall, index: number) => Promise<LlmToolReply>, toolResult?: ToolRunResult) {
    const store = { read: async () => ({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'test-model', apiKey: null, ...settings }) } as unknown as LlmSettingsStore;
    const calls: LlmCall[] = [];
    const client = {
      chatWithTools: async (_endpoint: LlmEndpoint, _model: string, messages: LlmToolMessage[], tools: LlmToolDefinition[]) => {
        const call = { messages: [...messages], tools };
        calls.push(call);
        return replies(call, calls.length - 1);
      },
    } as unknown as LlmClient;
    const runs: string[] = [];
    const toolbox = {
      definitions: () => [TOOL],
      run: async (_user: AuthUser, call: { name: string; arguments: string }) => {
        runs.push(`${call.name} ${call.arguments}`);
        return toolResult ?? { content: '{"제품":[]}', source: { kind: 'DATA', id: call.name, label: '재고 · SS275' } };
      },
    } as unknown as AssistantToolbox;
    return { service: new AiAssistantService(store, client, toolbox), calls, runs };
  }

  it('용어 사전을 찾아 답하고 출처·모델을 돌려준다', async () => {
    const { service, calls } = setup({}, async () => answer('예약은 합격 재고의 매수를 확보하는 거예요 [TRM-056].'));
    const reply = await service.ask(user, { question: '예약이 뭐야?' });
    expect(reply).toMatchObject({ answer: '예약은 합격 재고의 매수를 확보하는 거예요.', sources: [{ id: 'TRM-056' }], model: 'test-model' });
    expect(calls[0].messages[0].content).toContain('[TRM-056]');
    expect(calls[0].tools).toEqual([TOOL]);
  });

  it('모델이 도구를 고르면 실행 결과를 넘겨 다시 묻고, 조회 출처를 앞에 붙인다 (REQ-AST-004·009)', async () => {
    const { service, calls, runs } = setup({}, async (_call, index) => (index === 0 ? callTool('c1') : answer('SS275 코일 가용재고는 12매예요.')));
    const reply = await service.ask(user, { question: 'SS275 코일 재고 몇 매야?' });

    expect(runs).toEqual(['get_inventory {"keyword":"SS275"}']);
    expect(calls).toHaveLength(2);
    expect(calls[1].messages.slice(-2)).toEqual([
      { role: 'assistant', content: null, toolCalls: [{ id: 'c1', name: 'get_inventory', arguments: '{"keyword":"SS275"}' }] },
      { role: 'tool', toolCallId: 'c1', content: '{"제품":[]}' },
    ]);
    expect(reply.answer).toBe('SS275 코일 가용재고는 12매예요.');
    expect(reply.sources[0]).toEqual({ kind: 'DATA', id: 'get_inventory', label: '재고 · SS275' });
  });

  it('조회에 실패한 도구(권한 없음 등)는 출처로 남기지 않는다', async () => {
    const { service } = setup({}, async (_call, index) => (index === 0 ? callTool('c1') : answer('수주 조회 권한이 없어요.')), { content: '{"오류":"권한 없음"}', source: null });
    const reply = await service.ask(user, { question: '이 수주 진행 상황 알려줘' });
    expect(reply.sources.filter((s) => s.kind === 'DATA')).toEqual([]);
  });

  it(`도구 호출은 ${MAX_TOOL_ROUNDS}번까지, 그 뒤에는 도구 없이 답하게 하고 그래도 부르면 멈춘다`, async () => {
    const { service, calls, runs } = setup({}, async (_call, index) => callTool(`c${index}`));
    const reply = await service.ask(user, { question: 'SS275 재고' });
    expect(runs).toHaveLength(MAX_TOOL_ROUNDS);
    expect(calls).toHaveLength(MAX_TOOL_ROUNDS + 1);
    expect(calls.at(-1)?.tools).toEqual([]);
    expect(reply.answer).toBe(EMPTY_ANSWER);
  });

  it('용어 없이 이어 물으면 앞 질문의 용어를 참고 자료로 쓴다', async () => {
    const { service, calls } = setup({}, async () => answer('네'));
    await service.ask(user, { question: '그럼 그건 언제 풀려?', history: [{ role: 'user', content: '배정이 뭐야?' }, { role: 'assistant', content: '…' }] });
    expect(calls[0].messages[0].content).toContain('[TRM-060] 배정');
  });

  it('모델을 고르지 않았으면 LLM을 부르지 않고 COM-999(503)', async () => {
    const { service, calls } = setup({ model: null }, async () => answer(''));
    await expect(service.ask(user, { question: '예약이 뭐야?' })).rejects.toMatchObject({ code: 'COM-999', status: 503 });
    expect(calls).toHaveLength(0);
  });

  it('LLM 연결 실패는 그 이유를 COM-999(503)로 돌려주고, 다른 오류는 그대로 던진다', async () => {
    const failing = setup({}, async () => {
      throw new LlmRequestError('120초 안에 응답이 없어요');
    });
    const error = await failing.service.ask(user, { question: '예약이 뭐야?' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getResponse()).toEqual({ code: 'COM-999', message: '120초 안에 응답이 없어요' });

    const broken = setup({}, async () => {
      throw new TypeError('버그');
    });
    await expect(broken.service.ask(user, { question: '예약이 뭐야?' })).rejects.toBeInstanceOf(TypeError);
  });

  it('추천 질문은 로그인 사원의 역할 기준', () => {
    const { service } = setup({}, async () => answer(''));
    const view = service.suggestedQuestions({ ...user, roleCode: ROLE.QUALITY });
    expect(view.roleCode).toBe('QUALITY');
    expect(view.roleQuestions).toContain('비슷한 사례 찾아줘');
    expect(view.firstTimeQuestions).toContain('예약과 배정은 뭐가 달라?');
  });
});
