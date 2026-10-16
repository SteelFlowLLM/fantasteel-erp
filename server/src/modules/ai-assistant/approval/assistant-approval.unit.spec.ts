// 철강맨AI 승인 카드 (이슈 #362) 단위 시험. DB·LLM 없이 돈다 (npm run test:unit).
import { AI_ASSISTANT_TOOL_TITLE, AI_ASSISTANT_WRITE_TOOLS, PERMISSION, ROLE, type AiAssistantStreamEvent, type AuthUser } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AiAssistantRepository } from '../ai-assistant.repository';
import { buildAssistantMessages } from '../assistant.prompt';
import { ToolArgumentError } from '../tools/assistant-tool';
import { AssistantToolbox } from '../tools/assistant-toolbox';
import type { AssistantWriteTool, PreparedWrite } from '../tools/assistant-write-tool';
import { AssistantWriteToolbox } from '../tools/assistant-write-toolbox';
import { scheduleEventWriteTool } from '../tools/schedule-event.write-tool';
import { parseToolArguments } from '../tools/tool-schema';
import { AssistantApprovalRegistry } from './approval.registry';
import { APPROVAL_HEARTBEAT_MS, AssistantActionRunner, type WriteCallContext } from './assistant-action.runner';
import { isTransientError, MAX_FIX_ATTEMPTS, MAX_TRANSIENT_RETRIES, runWithTransientRetry, transientKind, WriteFixBudget } from './write-call.rules';

const user: AuthUser = {
  employeeId: 5,
  employeeNo: '2207005',
  employeeName: '정다은',
  roleCode: ROLE.PURCHASE,
  departmentId: 2,
  jobGradeId: 5,
  headDepartmentIds: [],
  permissions: {},
};
const other: AuthUser = { ...user, employeeId: 6, employeeNo: '2103003', employeeName: '박서영', roleCode: ROLE.SALES };

const unused = <T>() => ({}) as unknown as T;
const SCHEDULE_SCHEMA = scheduleEventWriteTool(unused()).definition.parameters;

describe('도구 종류 (조회는 묻지 않고, 쓰기는 늘 승인 카드)', () => {
  const readToolbox = new AssistantToolbox(unused(), unused(), unused(), unused(), unused(), unused(), unused(), unused(), unused(), unused(), unused(), unused(), unused());
  const writeToolbox = new AssistantWriteToolbox(unused(), unused(), unused(), unused(), unused());

  it('조회 도구는 모두 READ, 쓰기 도구는 모두 WRITE이고 겹치지 않는다', () => {
    const readNames = readToolbox.definitions().map((d) => d.name);
    const writeNames = writeToolbox.definitions().map((d) => d.name);
    expect(readNames.every((name) => readToolbox.kindOf(name) === 'READ')).toBe(true);
    expect(writeNames.every((name) => readToolbox.kindOf(name) === 'WRITE')).toBe(true);
    expect([...writeNames].sort()).toEqual([...AI_ASSISTANT_WRITE_TOOLS].sort());
    expect(readNames.filter((name) => writeNames.includes(name))).toEqual([]);
    expect(readToolbox.kindOf('drop_everything')).toBeNull();
  });

  it('모든 도구에 화면에 보일 한글 제목이 있다', () => {
    const names = [...readToolbox.definitions(), ...writeToolbox.definitions()].map((d) => d.name);
    expect(names.filter((name) => !AI_ASSISTANT_TOOL_TITLE[name])).toEqual([]);
  });

  it('조회 도구 모음은 쓰기 도구를 실행하지 않는다 (알리지 않은 대화에서 불러도)', async () => {
    const result = await readToolbox.run(user, { id: 'c1', name: 'add_my_schedule_event', arguments: '{"title":"x","date":"2026-10-20"}' });
    expect(JSON.parse(result.content).오류).toContain('업무 데이터를 바꿀 수 없어요');
    expect(result.source).toBeNull();
  });

  it('쓰기 도구 프롬프트 규칙은 쓰기 도구를 알릴 때만 넣는다', () => {
    const base = { employeeName: '정다은', roleLabel: '구매', today: '2026-10-16', screen: null, references: [], history: [], question: '내일 회의 잡아줘' };
    const readOnly = buildAssistantMessages(base)[0].content;
    const writable = buildAssistantMessages({ ...base, writeTools: true })[0].content;
    expect(readOnly).toContain('당신은 업무 데이터를 바꾸지 못해요');
    expect(readOnly).not.toContain('승인 카드');
    expect(writable).toContain('사용자가 허용해야 실행돼요');
    expect(writable).toContain('"실행했어요"가 오기 전에는 됐다고 말하지 않아요');
  });
});

describe('인자 스키마 검사', () => {
  it('맞는 인자는 통과하고, null인 칸은 보내지 않은 것으로 본다', () => {
    expect(parseToolArguments('{"title":"주간 회의","date":"2026-10-20","startTime":null}', SCHEDULE_SCHEMA)).toEqual({ ok: true, args: { title: '주간 회의', date: '2026-10-20' } });
    expect(parseToolArguments('', SCHEDULE_SCHEMA)).toMatchObject({ ok: false });
  });

  it('JSON이 아니거나 객체가 아니면 그 이유만', () => {
    expect(parseToolArguments('{title:', SCHEDULE_SCHEMA)).toEqual({ ok: false, errors: ['인자가 JSON이 아니에요'] });
    expect(parseToolArguments('[1]', SCHEDULE_SCHEMA)).toEqual({ ok: false, errors: ['인자는 객체여야 해요'] });
  });

  it('빠진 칸·없는 칸·틀린 형식을 한 번에 모두 알린다', () => {
    const parsed = parseToolArguments('{"date":"10/20","startTime":1400,"room":"A"}', SCHEDULE_SCHEMA);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual(expect.arrayContaining(['없는 인자예요: room', 'title가 필요해요', 'startTime는 글이어야 해요']));
    expect(parsed.errors.some((e) => e.startsWith('date의 형식이 틀렸어요'))).toBe(true);
  });

  it('숫자 칸은 따옴표 없는 0보다 큰 숫자만', () => {
    const schema = new AssistantWriteToolbox(unused(), unused(), unused(), unused(), unused()).get('create_purchase_request_draft')?.definition.parameters;
    if (!schema) throw new Error('도구 없음');
    expect(parseToolArguments('{"itemCode":"ORE01","requestedTon":"30"}', schema)).toEqual({ ok: false, errors: ['requestedTon는 숫자여야 해요 (따옴표 없이)'] });
    expect(parseToolArguments('{"itemCode":"ORE01","requestedTon":0}', schema)).toEqual({ ok: false, errors: ['requestedTon는 0보다 커야 해요'] });
    expect(parseToolArguments('{"itemCode":"ORE01","requestedTon":12.5}', schema)).toMatchObject({ ok: true });
  });
});

describe('고칠 기회', () => {
  it(`한 질문에서 ${MAX_FIX_ATTEMPTS}번까지 고친다 (처음까지 3번)`, () => {
    const budget = new WriteFixBudget();
    expect(budget.fail('add_my_schedule_event', '{"a":1}')).toBe(2);
    expect(budget.fail('add_my_schedule_event', '{"a":2}')).toBe(1);
    expect(budget.fail('create_purchase_request_draft', '{"a":3}')).toBe(0);
  });

  it('실패한 호출과 같은 도구·같은 인자면 다시 부른 것으로 본다 (키 순서·공백 무시)', () => {
    const budget = new WriteFixBudget();
    budget.fail('add_my_schedule_event', '{"title":"회의","date":"2026-10-20"}');
    expect(budget.isRepeat('add_my_schedule_event', ' { "date": "2026-10-20", "title": "회의" } ')).toBe(true);
    expect(budget.isRepeat('add_my_schedule_event', '{"title":"회의","date":"2026-10-21"}')).toBe(false);
    expect(budget.isRepeat('create_purchase_request_draft', '{"title":"회의","date":"2026-10-20"}')).toBe(false);
  });
});

describe('일시 오류만 같은 내용으로 다시', () => {
  const transient = () => new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict or a deadlock', { code: 'P2034', clientVersion: 'test' });

  it('일시 오류는 구분하고, 업무 오류·버그는 일시 오류가 아니다', () => {
    expect(isTransientError(transient())).toBe(true);
    expect(isTransientError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isTransientError(new Error('canceling statement due to lock timeout'))).toBe(true);
    expect(isTransientError(new AppException('COM-999'))).toBe(false);
    expect(isTransientError(new TypeError('x is undefined'))).toBe(false);
    expect(isTransientError(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }))).toBe(false);
  });

  it(`일시 오류면 ${MAX_TRANSIENT_RETRIES}번까지 다시 해서 처음까지 3번 시도한다`, async () => {
    let tries = 0;
    const failed = await runWithTransientRetry(async () => {
      tries += 1;
      throw transient();
    }, { idempotent: true, delayMs: 0 });
    expect(failed).toMatchObject({ ok: false, attempts: MAX_TRANSIENT_RETRIES + 1 });
    expect(tries).toBe(3);

    let flaky = 0;
    const recovered = await runWithTransientRetry(async () => {
      flaky += 1;
      if (flaky < 3) throw transient();
      return 'ok';
    }, { idempotent: true, delayMs: 0 });
    expect(recovered).toEqual({ ok: true, value: 'ok', attempts: 3 });
  });

  it('COMMIT 뒤에도 날 수 있는 오류(AMBIGUOUS)는 멱등 실행일 때만 다시 한다', async () => {
    const ambiguous = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(transientKind(ambiguous())).toBe('AMBIGUOUS');
    expect(transientKind(new Prisma.PrismaClientKnownRequestError('closed', { code: 'P1017', clientVersion: 'test' }))).toBe('AMBIGUOUS');
    expect(transientKind(new Prisma.PrismaClientKnownRequestError("Can't reach database server", { code: 'P1001', clientVersion: 'test' }))).toBe('SAFE');
    expect(transientKind(Object.assign(new Error('deadlock detected'), { code: '40P01' }))).toBe('SAFE');
    expect(transientKind(transient())).toBe('SAFE');

    let tries = 0;
    const notIdempotent = await runWithTransientRetry(async () => {
      tries += 1;
      throw ambiguous();
    }, { idempotent: false, delayMs: 0 });
    expect(notIdempotent).toMatchObject({ ok: false, attempts: 1 });
    expect(tries).toBe(1);

    let safeTries = 0;
    await runWithTransientRetry(async () => {
      safeTries += 1;
      throw transient();
    }, { idempotent: false, delayMs: 0 });
    expect(safeTries).toBe(MAX_TRANSIENT_RETRIES + 1);
  });

  it('업무 오류는 다시 하지 않는다', async () => {
    let tries = 0;
    const result = await runWithTransientRetry(async () => {
      tries += 1;
      throw new AppException('PUR-001');
    }, { idempotent: true, delayMs: 0 });
    expect(result).toMatchObject({ ok: false, attempts: 1 });
    expect(tries).toBe(1);
  });
});

describe('승인 카드 자리', () => {
  let registry: AssistantApprovalRegistry;
  beforeEach(() => {
    registry = new AssistantApprovalRegistry();
  });
  afterEach(() => registry.onModuleDestroy());

  it('처음 고른 값으로 끝나고, 늦게 온 값은 AST-002(409)', async () => {
    const pending = registry.open(user.employeeId);
    expect(pending.expiresAt.getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
    const fresh = { ...user, permissions: { PURCHASE_REQUISITION_CREATE: 'USE' as const } };
    registry.decide(fresh, pending.id, 'ALLOW');
    // 허용을 보낸 요청의 사원 정보(그 순간의 권한)를 함께 넘긴다
    await expect(pending.decision).resolves.toEqual({ resolution: 'ALLOW', decidedBy: fresh });
    expect(() => registry.decide(user, pending.id, 'DENY')).toThrow(expect.objectContaining({ code: 'AST-002', status: 409 }));
    expect(registry.pendingCount()).toBe(0);
  });

  it('질문한 사원만 고를 수 있다 (COM-002 403). 다른 사원이 골라도 카드는 그대로 기다린다', async () => {
    const pending = registry.open(user.employeeId);
    expect(() => registry.decide(other, pending.id, 'ALLOW')).toThrow(expect.objectContaining({ code: 'COM-002', status: 403 }));
    expect(registry.pendingCount()).toBe(1);
    registry.decide(user, pending.id, 'DENY');
    await expect(pending.decision).resolves.toEqual({ resolution: 'DENY', decidedBy: user });
  });

  it('없는 카드는 AST-001(404)', () => {
    expect(() => registry.decide(user, '00000000-0000-4000-8000-000000000000', 'ALLOW')).toThrow(expect.objectContaining({ code: 'AST-001', status: 404 }));
  });

  it('시간이 지나면 거부(TIMEOUT)로 끝나고, 그 뒤 허용은 AST-002', async () => {
    const pending = registry.open(user.employeeId, undefined, 20);
    await expect(pending.decision).resolves.toEqual({ resolution: 'TIMEOUT', decidedBy: null });
    expect(() => registry.decide(user, pending.id, 'ALLOW')).toThrow(expect.objectContaining({ code: 'AST-002' }));
  });

  it('화면이 연결을 끊으면 거부로 끝난다 (이미 끊긴 연결도)', async () => {
    const abort = new AbortController();
    const pending = registry.open(user.employeeId, abort.signal);
    abort.abort();
    await expect(pending.decision).resolves.toEqual({ resolution: 'DENY', decidedBy: null });

    const gone = registry.open(user.employeeId, AbortSignal.abort());
    await expect(gone.decision).resolves.toMatchObject({ resolution: 'DENY' });
  });
});

describe('쓰기 도구 호출 처리 (AssistantActionRunner)', () => {
  const roleLookups: string[] = [];
  let registry: AssistantApprovalRegistry;
  beforeEach(() => {
    registry = new AssistantApprovalRegistry();
    roleLookups.length = 0;
  });
  afterEach(() => registry.onModuleDestroy());

  function setup(prepare: AssistantWriteTool['prepare']) {
    const tool: AssistantWriteTool = { definition: { name: 'add_my_schedule_event', description: '', parameters: SCHEDULE_SCHEMA }, permissions: [PERMISSION.PURCHASE_REQUISITION_CREATE], prepare };
    const writeTools = { get: (name: string) => (name === tool.definition.name ? tool : undefined) } as unknown as AssistantWriteToolbox;
    const repository = {
      findRoleCodesWithAnyPermission: async (_tx: unknown, _permissions: unknown, level: string) => {
        roleLookups.push(level);
        return [ROLE.PURCHASE, ROLE.ADMIN];
      },
    } as unknown as AiAssistantRepository;
    const runner = new AssistantActionRunner(writeTools, registry, {} as PrismaService, repository);
    const events: AiAssistantStreamEvent[] = [];
    const budget = new WriteFixBudget();
    const ctx = (args: string, onEvent?: (event: AiAssistantStreamEvent) => void): WriteCallContext => ({
      user,
      call: { id: 'c1', name: 'add_my_schedule_event', arguments: args },
      toolId: 't1',
      question: '내일 회의 잡아줘',
      emit: (event) => {
        events.push(event);
        onEvent?.(event);
      },
      budget,
    });
    return { runner, events, ctx };
  }

  const ok = (execute: PreparedWrite['execute']): PreparedWrite => ({ card: { title: '내 일정 추가: 회의', details: [{ label: '제목', value: '회의' }] }, execute });
  const success = async (_actor?: AuthUser, _approvalId?: string) => ({ message: '추가했어요', result: { table: 'schedule_event', id: 9, label: '회의', linkPath: '/schedule?week=2026-10-19' } });

  it('스키마가 틀리면 카드 없이 이유를 돌려주고, 세 번째 실패에서 멈춘다', async () => {
    const { runner, events, ctx } = setup(async () => ok(success));
    const first = await runner.run(ctx('{"date":"2026-10-20"}'));
    expect(first.stop).toBe(false);
    expect(JSON.parse(first.content)).toMatchObject({ 오류: 'title가 필요해요' });
    expect(JSON.parse(first.content).안내).toContain('남은 기회 2번');
    expect((await runner.run(ctx('{"date":"2026-10-21"}'))).stop).toBe(false);
    const third = await runner.run(ctx('{"date":"2026-10-22"}'));
    expect(third.stop).toBe(true);
    expect(JSON.parse(third.content).안내).toContain('여러 번 고쳐도 맞지 않아');
    expect(events).toEqual([]);
  });

  it('사전 확인 실패(형식·대상 없음)는 고칠 수 있고, 같은 인자로 다시 부르면 바로 멈춘다', async () => {
    const { runner, ctx } = setup(async () => {
      throw new AppException('COM-004', '끝나는 시각은 시작 시각보다 뒤여야 해요');
    });
    const args = '{"title":"회의","date":"2026-10-20","startTime":"15:00","endTime":"14:00"}';
    const first = await runner.run(ctx(args));
    expect(first).toMatchObject({ stop: false });
    expect(JSON.parse(first.content).오류).toBe('끝나는 시각은 시작 시각보다 뒤여야 해요');
    const repeat = await runner.run(ctx(args));
    expect(repeat.stop).toBe(true);
    expect(JSON.parse(repeat.content).오류).toContain('같은 인자로 다시');
  });

  it('도구가 던진 인자 오류(ToolArgumentError)도 고칠 수 있는 실패다', async () => {
    const { runner, ctx } = setup(async () => {
      throw new ToolArgumentError('date 2026-02-30는 없는 날짜예요');
    });
    const outcome = await runner.run(ctx('{"title":"회의","date":"2026-02-30"}'));
    expect(outcome.stop).toBe(false);
    expect(JSON.parse(outcome.content).오류).toBe('date 2026-02-30는 없는 날짜예요');
  });

  it('권한 없음은 고치지 않고 바로 멈추며, 사용 권한이 있는 역할을 안내한다', async () => {
    const { runner, events, ctx } = setup(async () => {
      throw new AppException('COM-002', '구매요청 등록 권한이 있어야 이 초안을 만들 수 있어요');
    });
    const outcome = await runner.run(ctx('{"title":"회의","date":"2026-10-20"}'));
    expect(outcome.stop).toBe(true);
    expect(JSON.parse(outcome.content)).toMatchObject({ 오류: '권한 없음', '할 수 있는 역할': ['구매', '관리자'] });
    expect(roleLookups).toEqual(['USE']);
    expect(events).toEqual([]);
  });

  it('승인권자 없음(PUR-001)처럼 모델이 고칠 수 없는 업무 오류도 바로 멈춘다', async () => {
    const { runner, ctx } = setup(async () => {
      throw new AppException('PUR-001');
    });
    const outcome = await runner.run(ctx('{"title":"회의","date":"2026-10-20"}'));
    expect(outcome.stop).toBe(true);
    expect(JSON.parse(outcome.content).오류).toBe('승인권자(부서장) 미지정');
  });

  it('카드 자리를 먼저 만들고 이벤트를 보낸다: 이벤트를 받자마자 허용해도 실행된다. 실행은 허용한 순간의 사원·카드 id로', async () => {
    const executions: [AuthUser, string][] = [];
    const fresh = { ...user, permissions: { PURCHASE_REQUISITION_CREATE: 'USE' as const } };
    const { runner, events, ctx } = setup(async () =>
      ok(async (actor, approvalId) => {
        executions.push([actor, approvalId]);
        return success();
      }),
    );
    let approvalId = '';
    const outcome = await runner.run(
      ctx('{"title":"회의","date":"2026-10-20"}', (event) => {
        if (event.type !== 'approval_required') return;
        approvalId = event.approvalId;
        registry.decide(fresh, event.approvalId, 'ALLOW');
      }),
    );
    expect(executions).toEqual([[fresh, approvalId]]);
    expect(events.map((e) => e.type)).toEqual(['approval_required', 'approval_resolved', 'tool_execution']);
    expect(events[0]).toMatchObject({ toolId: 't1', toolName: 'add_my_schedule_event', title: '내 일정 추가: 회의', details: [{ label: '제목', value: '회의' }] });
    expect(events[1]).toMatchObject({ decision: 'ALLOW' });
    expect(events[2]).toMatchObject({ status: 'SUCCESS', attempts: 1, result: { table: 'schedule_event', id: 9 } });
    expect(JSON.parse(outcome.content).결과).toBe('실행했어요');
  });

  it('거부하면 실행하지 않고, 거부했다고 모델에 알린다', async () => {
    let executed = 0;
    const { runner, events, ctx } = setup(async () =>
      ok(async () => {
        executed += 1;
        return success();
      }),
    );
    const outcome = await runner.run(
      ctx('{"title":"회의","date":"2026-10-20"}', (event) => {
        if (event.type === 'approval_required') registry.decide(user, event.approvalId, 'DENY');
      }),
    );
    expect(executed).toBe(0);
    expect(events.map((e) => e.type)).toEqual(['approval_required', 'approval_resolved']);
    expect(JSON.parse(outcome.content).결과).toBe('사용자가 거부해 실행하지 않았어요');
    // 사용자가 싫다고 했으니 다음 차례는 도구 없이 답한다 (다시 제안해 스트림을 붙잡지 않게)
    expect(outcome.stop).toBe(true);
  });

  it('허용 뒤 업무 오류로 실패하면 다시 하지 않고 실패와 이유를 알린다', async () => {
    let executed = 0;
    const { runner, events, ctx } = setup(async () =>
      ok(async () => {
        executed += 1;
        throw new AppException('PUR-001', '부서장이 정해지지 않았어요');
      }),
    );
    const outcome = await runner.run(
      ctx('{"title":"회의","date":"2026-10-20"}', (event) => {
        if (event.type === 'approval_required') registry.decide(user, event.approvalId, 'ALLOW');
      }),
    );
    expect(executed).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: 'tool_execution', status: 'FAILED', message: '부서장이 정해지지 않았어요', result: null, attempts: 1 });
    expect(outcome.stop).toBe(false);
    expect(JSON.parse(outcome.content).안내).toContain('새 승인 카드');
  });

  it('시간 초과도 실행하지 않고 멈춘다. 기다리는 동안 20초마다 heartbeat를 보낸다', async () => {
    jest.useFakeTimers();
    try {
      let executed = 0;
      const { runner, events, ctx } = setup(async () =>
        ok(async () => {
          executed += 1;
          return success();
        }),
      );
      const running = runner.run(ctx('{"title":"회의","date":"2026-10-20"}'));
      await jest.advanceTimersByTimeAsync(APPROVAL_HEARTBEAT_MS * 2 + 1);
      expect(events.filter((e) => e.type === 'heartbeat')).toHaveLength(2);
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      const outcome = await running;
      expect(executed).toBe(0);
      expect(outcome.stop).toBe(true);
      expect(JSON.parse(outcome.content).결과).toBe('10분 안에 허용하지 않아 실행하지 않았어요');
      const resolvedAt = events.findIndex((e) => e.type === 'approval_resolved');
      expect(events[resolvedAt]).toMatchObject({ decision: 'TIMEOUT' });
      // 끝난 뒤에는 heartbeat가 멈춘다
      const beats = events.filter((e) => e.type === 'heartbeat').length;
      await jest.advanceTimersByTimeAsync(APPROVAL_HEARTBEAT_MS * 3);
      expect(events.filter((e) => e.type === 'heartbeat')).toHaveLength(beats);
    } finally {
      jest.useRealTimers();
    }
  });
});
