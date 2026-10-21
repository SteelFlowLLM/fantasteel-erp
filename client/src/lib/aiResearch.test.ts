import type { AiResearchEventView, AiResearchPlan, AiResearchRunView } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { addPlanStep, canCancelRun, canRenameRun, canRerunRun, inlineOf, isPlanChanged, mergeRunView, movePlanStep, nextAfterSeq, normalizePlan, planBlockReason, planQueryKey, revisionBlockReason, revisionTurns, versionLabel, planSuggestionDiff, planSuggestionSummary, planTitleProblem, progressText, removePlanStep, reportBlocks, reportFallbackLabel, nextRunPreview, researchPdfName, scheduleDraftOf, scheduleDraftProblem, scheduleInputOf, toggleWeekday, shouldPollRun, sourceRows, stripSourceSection, timelineLineOf, validatePlan } from '@/lib/aiResearch';

const at = '2026-10-17T01:00:00.000Z';
const sources = [
  { id: 1, title: '철강 시장 <b>보고</b>', url: 'https://www.example.com/a', snippet: '', read: true },
  { id: 2, title: '두 번째', url: 'javascript:alert(1)', snippet: '', read: false },
];

describe('폴링 조건', () => {
  it('계획 중·대기·조사 중에만 계속 읽는다', () => {
    expect(['PLANNING', 'QUEUED', 'RUNNING'].map((s) => shouldPollRun(s as never))).toEqual([true, true, true]);
    expect(['AWAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED'].map((s) => shouldPollRun(s as never))).toEqual([false, false, false, false]);
    expect(shouldPollRun(undefined)).toBe(false);
  });
  it('끝나지 않은 조사만 취소할 수 있다', () => {
    expect(canCancelRun('AWAITING_APPROVAL')).toBe(true);
    expect(canCancelRun('COMPLETED')).toBe(false);
  });
  it('끝난(완료·실패·취소) 조사만 다시 조사할 수 있다', () => {
    expect(['COMPLETED', 'FAILED', 'CANCELLED'].map((s) => canRerunRun(s as never))).toEqual([true, true, true]);
    expect(['PLANNING', 'AWAITING_APPROVAL', 'QUEUED', 'RUNNING'].map((s) => canRerunRun(s as never))).toEqual([false, false, false, false]);
  });
  it('머리의 제목 바꾸기는 계획이 있고 계획 확인 대기가 아닐 때만 (대기 중에는 계획 칸에서 고친다)', () => {
    const plan = { title: 't', steps: [] };
    expect(canRenameRun({ status: 'RUNNING', plan })).toBe(true);
    expect(canRenameRun({ status: 'COMPLETED', plan })).toBe(true);
    expect(canRenameRun({ status: 'AWAITING_APPROVAL', plan })).toBe(false);
    expect(canRenameRun({ status: 'PLANNING', plan: null })).toBe(false);
    expect(canRenameRun({ status: 'CANCELLED', plan: null })).toBe(false);
  });
});

describe('이벤트 이어 붙이기', () => {
  const ev = (seq: number): AiResearchEventView => ({ seq, type: 'cancelled', payload: {}, createdAt: at });
  const run = (events: AiResearchEventView[], status = 'RUNNING'): AiResearchRunView => ({ id: 1, status, events, lastSeq: nextAfterSeq(events) }) as unknown as AiResearchRunView;
  it('순번이 겹치지 않게 쌓고 나머지는 새 값을 쓴다', () => {
    const merged = mergeRunView(run([ev(1), ev(2)]), run([ev(2), ev(3)], 'COMPLETED'));
    expect(merged.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(merged.status).toBe('COMPLETED');
  });
  it('다른 조사거나 처음이면 새 것을 그대로 쓴다', () => {
    const other = { ...run([ev(1)]), id: 2 } as AiResearchRunView;
    expect(mergeRunView(run([ev(5)]), other).events.map((e) => e.seq)).toEqual([1]);
    expect(nextAfterSeq([])).toBe(0);
  });
});

describe('타임라인', () => {
  it('검색 완료는 검색어와 결과 수를 보인다', () => {
    const line = timelineLineOf({ seq: 1, type: 'search.done', createdAt: at, payload: { query: '열연 가격', engine: 'x', resultCount: 5, added: 3, error: null } });
    expect(line.title).toContain('열연 가격');
    expect(line.title).toContain('5개');
  });
  it('출처 제목은 글로만(태그 글자 그대로) 쓰고 호스트를 따로 보인다', () => {
    const line = timelineLineOf({ seq: 2, type: 'source.added', createdAt: at, payload: { sourceId: 1, title: '<b>제목</b>', url: 'https://www.example.com/a' } });
    expect(line.title).toBe('출처 [1] <b>제목</b>');
    expect(line.detail).toBe('example.com');
  });
  it('우리 ERP 조회 출처는 링크 없이 우리 회사 ERP로 보인다 (이슈 #435)', () => {
    const line = timelineLineOf({ seq: 2, type: 'source.added', createdAt: at, payload: { sourceId: 3, title: 'ERP 조회(get_inventory)', url: 'erp:get_inventory' } });
    expect(line.title).toBe('출처 [3] ERP 조회(get_inventory)');
    expect(line.detail).toBe('우리 회사 ERP');
    const erp = { id: 3, title: 'ERP 조회(get_inventory)', url: 'erp:get_inventory', snippet: '', read: true };
    expect(sourceRows([erp])[0]).toMatchObject({ host: '우리 회사 ERP', href: null });
    const budget = { maxSteps: 8, maxSources: 20 };
    expect(progressText({ stepsUsed: 2, budget, sources: [erp, { ...erp, id: 4, url: 'https://www.example.com/a' }] })).toBe('2/8 단계 · 출처 1/20');
  });
  it('사내 지식 출처는 링크 없이 사내 지식으로 보이고 웹 출처 자리에 세지 않는다 (이슈 #484)', () => {
    const line = timelineLineOf({ seq: 2, type: 'source.added', createdAt: at, payload: { sourceId: 1, title: '사내 지식 · KS 규격 8. 강종별 기준값', url: 'knowledge:ks:KS-8' } });
    expect(line.detail).toBe('사내 지식');
    const knowledge = { id: 1, title: '사내 지식 · KS 규격 8. 강종별 기준값', url: 'knowledge:ks:KS-8', snippet: '', read: true };
    const erp = { id: 2, title: 'ERP 조회(get_inventory)', url: 'erp:get_inventory', snippet: '', read: true };
    const web = { id: 3, title: '웹 글', url: 'https://www.example.com/a', snippet: '', read: false };
    expect(sourceRows([web, erp, knowledge]).map((row) => [row.id, row.kind, row.host, row.href])).toEqual([
      [1, 'knowledge', '사내 지식', null],
      [2, 'erp', '우리 회사 ERP', null],
      [3, 'web', 'example.com', 'https://www.example.com/a'],
    ]);
    expect(progressText({ stepsUsed: 1, budget: { maxSteps: 8, maxSources: 20 }, sources: [knowledge, erp, web] })).toBe('1/8 단계 · 출처 1/20');
  });
  it('실패한 읽기·검색은 경고 톤', () => {
    expect(timelineLineOf({ seq: 3, type: 'page.read', createdAt: at, payload: { sourceId: 1, title: '', chars: 0, error: '시간 초과' } }).tone).toBe('wait');
    expect(timelineLineOf({ seq: 4, type: 'failed', createdAt: at, payload: { reason: '이유' } }).tone).toBe('danger');
  });
  it('다시 조사로 가져온 계획은 어느 조사에서 왔는지 보인다', () => {
    const payload = { title: '계획', stepCount: 2, revision: 1, fallback: false };
    expect(timelineLineOf({ seq: 1, type: 'plan.ready', createdAt: at, payload: { ...payload, copiedFrom: 7 } }).title).toBe('조사 #7의 계획을 가져왔어요 · 2단계');
    expect(timelineLineOf({ seq: 1, type: 'plan.ready', createdAt: at, payload }).title).toBe('계획을 세웠어요 · 2단계');
    expect(timelineLineOf({ seq: 1, type: 'plan.ready', createdAt: at, payload: { ...payload, copiedFrom: 7, scheduled: true } }).title).toBe('반복 차례라 조사 #7의 계획으로 시작했어요 · 2단계');
  });
  it('보고서 시간 초과 다시 시도와 대체본 보고서는 경고 톤으로 까닭을 보인다 (이슈 #521)', () => {
    const retry = timelineLineOf({ seq: 6, type: 'report.retry', createdAt: at, payload: { timeoutMinutes: 10 } });
    expect(retry).toMatchObject({ tone: 'wait', title: '보고서가 10분 안에 오지 않아 한 번 더 부탁했어요' });
    const ready = { chars: 1200, truncated: false, citedCount: 0, incomplete: true };
    expect(timelineLineOf({ seq: 7, type: 'report.ready', createdAt: at, payload: { ...ready, fallback: 'TIMEOUT' } })).toMatchObject({ tone: 'wait', title: '대체본을 남겼어요 · 보고서 생성 시간 초과' });
    expect(timelineLineOf({ seq: 7, type: 'report.ready', createdAt: at, payload: ready })).toMatchObject({ tone: 'ok', title: '보고서를 썼어요' });
  });
  it('대체본 표시: 조사 메모로 대신 쓴 것과 앞 판을 그대로 둔 것을 나눈다', () => {
    expect(reportFallbackLabel({ reason: 'TIMEOUT', previous: false })).toBe('대체본(보고서 생성 시간 초과)');
    expect(reportFallbackLabel({ reason: 'ERROR', previous: true })).toBe('앞 판 그대로(보고서 생성 실패)');
    expect(reportFallbackLabel({ reason: 'LLM_DOWN', previous: false })).toBe('대체본(AI 응답 끊김)');
    expect(reportFallbackLabel(null)).toBeNull();
  });
  it('조사 메모는 요약과 모자란 것 개수를 보인다', () => {
    const line = timelineLineOf({ seq: 5, type: 'state.updated', createdAt: at, payload: { summary: '요약', gapCount: 2, unsupportedCount: 0 } });
    expect(line.detail).toBe('요약\n아직 모르는 것 2개');
  });
});

describe('보고서 인용 연결', () => {
  it('[n]은 모은 출처 번호일 때만 인용으로 바꾼다', () => {
    expect(inlineOf('값은 오른다[1][2, 1] 그리고 [9]', sources)).toEqual([
      { kind: 'text', text: '값은 오른다' },
      { kind: 'cite', id: 1 },
      { kind: 'cite', id: 2 },
      { kind: 'text', text: ' ' },
      { kind: 'cite', id: 1 },
      { kind: 'text', text: ' 그리고 [9]' },
    ]);
  });
  it('링크는 모은 출처 주소일 때만, 나머지는 글', () => {
    const inline = inlineOf('[여기](https://www.example.com/a) [나쁨](https://evil.example/x)', sources);
    expect(inline[0]).toEqual({ kind: 'link', text: '여기', href: 'https://www.example.com/a' });
    expect(inline.filter((i) => i.kind === 'link')).toHaveLength(1);
  });
  it('제목·목록·문단으로 나누고 출처 목록은 뗀다', () => {
    const report = ['## 요약', '내용 [1]', '이어서', '', '- 하나', '- 둘 [2]', '', '## 출처', '- [1] [제목](https://www.example.com/a)'].join('\n');
    expect(stripSourceSection(report)).not.toContain('출처');
    const blocks = reportBlocks(report, sources);
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list']);
    expect(blocks[2]).toMatchObject({ kind: 'list' });
    expect((blocks[2] as { items: unknown[] }).items).toHaveLength(2);
  });
  it('HTML은 글 그대로 남고, 위험한 주소는 링크가 되지 않는다', () => {
    const rows = sourceRows(sources);
    expect(rows[0].title).toBe('철강 시장 <b>보고</b>');
    expect(rows[0].href).toBe('https://www.example.com/a');
    expect(rows[1].href).toBeNull();
  });
});

describe('계획 고치기', () => {
  const plan: AiResearchPlan = { title: '조사', steps: [{ title: 'A', query: '열연 가격' }, { title: 'B', query: '냉연 가격' }] };
  it('정상 계획은 문제가 없다', () => {
    expect(validatePlan(plan)).toBeNull();
  });
  it('빈 칸·길이·같은 검색어·단계 수를 잡는다', () => {
    const bad = validatePlan({ title: ' ', steps: [{ title: '', query: 'x'.repeat(81) }, { title: 'B', query: '열연 가격' }, { title: 'C', query: ' 열연  가격 ' }] });
    expect(bad?.title).not.toBeNull();
    expect(bad?.steps[0]).toEqual({ title: '단계 이름을 적어 주세요', query: '검색어는 80자까지 쓸 수 있어요' });
    expect(bad?.steps[2].query).toBe('같은 검색어가 또 있어요');
    expect(validatePlan({ title: 't', steps: [] })?.general).not.toBeNull();
    const many = Array.from({ length: 7 }, (_, i) => ({ title: `s${i}`, query: `q${i}` }));
    expect(validatePlan({ title: 't', steps: many })?.general).toContain('6개');
  });
  it('단계는 6개까지 늘고, 지우고, 옮긴다', () => {
    let steps = plan.steps;
    for (let i = 0; i < 10; i += 1) steps = addPlanStep(steps);
    expect(steps).toHaveLength(6);
    expect(removePlanStep(plan.steps, 0).map((s) => s.title)).toEqual(['B']);
    expect(movePlanStep(plan.steps, 0, 1).map((s) => s.title)).toEqual(['B', 'A']);
    expect(movePlanStep(plan.steps, 0, -1).map((s) => s.title)).toEqual(['A', 'B']);
  });
  it('시작·저장을 막는 까닭은 맨 앞 문제를 칸 이름과 함께, 더 있으면 남은 곳 수', () => {
    expect(planBlockReason(validatePlan(plan))).toBeNull();
    expect(planBlockReason(validatePlan({ ...plan, steps: [plan.steps[0], { title: 'B', query: ' ' }] }))).toBe('2단계: 검색어를 적어 주세요');
    expect(planBlockReason(validatePlan({ title: '', steps: [{ title: '', query: '열연 가격' }, { title: 'B', query: '열연 가격' }] }))).toBe('제목을 적어 주세요 외 2곳');
    expect(planBlockReason(validatePlan({ title: 't', steps: [] }))).toBe('단계를 하나 이상 넣어 주세요');
  });
  it('제목 확인은 빈 칸과 100자 상한', () => {
    expect(planTitleProblem('  ')).toBe('제목을 적어 주세요');
    expect(planTitleProblem('x'.repeat(101))).toBe('제목은 100자까지 쓸 수 있어요');
    expect(planTitleProblem(' 새 제목 ')).toBeNull();
  });
  it('공백만 다른 수정은 바뀐 것이 아니다', () => {
    expect(isPlanChanged(plan, { ...plan, title: ' 조사 ' })).toBe(false);
    expect(isPlanChanged(plan, { ...plan, title: '다른' })).toBe(true);
    expect(normalizePlan({ title: ' a ', steps: [{ title: ' b', query: 'c ' }] })).toEqual({ title: 'a', steps: [{ title: 'b', query: 'c' }] });
  });
});

describe('계획을 말로 고치기 표시 (이슈 #416)', () => {
  const base: AiResearchPlan = {
    title: '조사',
    steps: [
      { title: '현황', query: '열연 가격' },
      { title: '원인', query: '철광석 가격' },
      { title: '반론', query: '열연 가격 하락 전망' },
    ],
  };
  it('같은 검색어는 그대로(이름이 다르면 바뀜), 같은 이름은 검색어가 바뀐 것, 나머지는 새 단계·빠진 단계', () => {
    const next: AiResearchPlan = {
      title: '조사',
      steps: [
        { title: '현황', query: '가격, 열연' },
        { title: '원인', query: '원료탄 가격 통계' },
        { title: '가격 전망', query: '열연 가격 전망 2026' },
      ],
    };
    const diff = planSuggestionDiff(base, next);
    expect(diff.marks).toEqual(['same', 'changed', 'new']);
    expect(diff.removed.map((s) => s.title)).toEqual(['반론']);
    expect(diff.titleChanged).toBe(false);
    expect(planSuggestionSummary(diff)).toBe('새 단계 1 · 바뀐 단계 1 · 빠진 단계 1');
  });
  it('순서만 바꾸거나 공백만 다르면 그대로이고, 제목이 바뀌면 알린다', () => {
    const diff = planSuggestionDiff(base, { title: '새 조사', steps: [base.steps[2], base.steps[0], { title: ' 원인 ', query: '철광석  가격' }] });
    expect(diff.marks).toEqual(['same', 'same', 'same']);
    expect(diff.removed).toEqual([]);
    expect(planSuggestionSummary(diff)).toBe('제목 바뀜');
    expect(planSuggestionSummary(planSuggestionDiff(base, base))).toBeNull();
  });
  it('검색어가 같고 이름만 바뀌면 바뀐 단계, 빈 칸 단계는 이름으로 짝짓지 않는다', () => {
    const diff = planSuggestionDiff({ title: 't', steps: [{ title: '', query: '' }, { title: 'A', query: '열연 가격' }] }, { title: 't', steps: [{ title: 'A2', query: '열연 가격' }, { title: '', query: '냉연' }] });
    expect(diff.marks).toEqual(['changed', 'new']);
    expect(diff.removed).toEqual([{ title: '', query: '' }]);
    expect(planQueryKey('탄소 배출, 고로')).toBe(planQueryKey('고로 탄소 배출 고로'));
  });
});

describe('보고서 판·고치기 기록 (이슈 #418)', () => {
  const v = (version: number, instruction: string | null, search = false) => ({ version, instruction, search, createdAt: '2026-10-20T03:00:00.000Z' });
  it('판 이름: 1판은 처음 보고서, 부탁 없는 뒤 판은 더 조사하기', () => {
    expect(versionLabel(v(1, null))).toBe('1판 · 처음 보고서');
    expect(versionLabel(v(2, '3장 보강'))).toBe('2판');
    expect(versionLabel(v(3, null))).toBe('3판 · 더 조사하기');
  });
  it('고치기 기록은 1판 뒤 판마다, 고치는 중이면 맨 끝에 그 부탁', () => {
    const turns = revisionTurns({ versions: [v(1, null), v(2, '3장 보강', true), v(3, null)], pendingRevision: { version: 4, instruction: '줄여 줘', search: false } });
    expect(turns.map((t) => [t.version, t.instruction, t.pending])).toEqual([
      [2, '3장 보강', false],
      [3, null, false],
      [4, '줄여 줘', true],
    ]);
    expect(revisionTurns({ versions: [], pendingRevision: null })).toEqual([]);
  });
  it('고치기 칸이 꺼진 까닭: 고치는 중·판 상한·완료 전', () => {
    const base = { status: 'COMPLETED' as const, canRevise: true, versions: [], pendingRevision: null };
    expect(revisionBlockReason(base)).toBeNull();
    expect(revisionBlockReason({ ...base, status: 'QUEUED', canRevise: false, pendingRevision: { version: 2, instruction: 'a', search: true } })).toContain('2판을 쓰는 중');
    expect(revisionBlockReason({ ...base, canRevise: false, versions: Array.from({ length: 10 }, (_, i) => v(i + 1, null)) })).toContain('10개까지');
    expect(revisionBlockReason({ ...base, status: 'CANCELLED', canRevise: false })).toContain('끝난 뒤');
  });
  it('타임라인: 고치기 요청·새 판', () => {
    const requested = timelineLineOf({ seq: 1, type: 'revision.requested', payload: { version: 2, instruction: '3장 보강', search: true, addedSteps: 4 }, createdAt: '2026-10-20T03:00:00.000Z' });
    expect(requested).toMatchObject({ tone: 'ai', title: '보고서 고치기 요청 · 2판', detail: '3장 보강\n필요하면 4단계까지 더 찾아요' });
    expect(timelineLineOf({ seq: 2, type: 'revision.requested', payload: { version: 3, instruction: 'a', search: false, addedSteps: 0 }, createdAt: '2026-10-20T03:00:00.000Z' }).detail).toContain('검색 없이');
    expect(timelineLineOf({ seq: 3, type: 'revision.ready', payload: { version: 2, chars: 1200 }, createdAt: '2026-10-20T03:00:00.000Z' })).toMatchObject({ tone: 'ok', title: '2판 보고서를 썼어요', detail: '1,200자' });
  });
});

describe('진행 글', () => {
  it('단계와 출처를 분모와 함께 보인다', () => {
    expect(progressText({ stepsUsed: 3, budget: { maxSteps: 8, maxSources: 20 }, sources: [sources[0]] })).toBe('3/8 단계 · 출처 1/20');
  });
});

describe('반복 걸기 창 (이슈 #521)', () => {
  it('처음 값은 지금 반복, 없으면 매일 09:00', () => {
    expect(scheduleDraftOf(null)).toEqual({ frequency: 'DAILY', weekdays: [], time: '09:00' });
    const schedule = { id: 1, runId: 3, title: '제목', frequency: 'WEEKLY' as const, weekdays: [1, 3], time: '18:30', enabled: true, nextRunAt: null, lastRunAt: null, lastRunId: null, lastSkipReason: null };
    expect(scheduleDraftOf(schedule)).toEqual({ frequency: 'WEEKLY', weekdays: [1, 3], time: '18:30' });
  });
  it('요일 켜고 끄기·저장할 수 없는 까닭·보낼 값', () => {
    expect(toggleWeekday([3, 1], 5)).toEqual([1, 3, 5]);
    expect(toggleWeekday([1, 3], 3)).toEqual([1]);
    expect(scheduleDraftProblem({ frequency: 'WEEKLY', weekdays: [], time: '09:00' })).toBe('반복할 요일을 하나 이상 골라 주세요');
    expect(scheduleDraftProblem({ frequency: 'DAILY', weekdays: [], time: '' })).toBe('실행 시각을 골라 주세요');
    expect(scheduleDraftProblem({ frequency: 'DAILY', weekdays: [2], time: '07:05' })).toBeNull();
    // 매일로 바꾸면 고른 요일은 보내지 않는다
    expect(scheduleInputOf({ frequency: 'DAILY', weekdays: [2], time: '07:05' })).toEqual({ frequency: 'DAILY', weekdays: [], time: '07:05' });
  });
  it('다음 실행 미리 보기는 서울 시각, 틀린 규칙이면 null', () => {
    // 2026-10-22(목) 10:00 서울
    const now = new Date('2026-10-22T01:00:00Z');
    expect(nextRunPreview({ frequency: 'DAILY', weekdays: [], time: '09:00' }, now)).toBe('10-23 (금) 09:00');
    expect(nextRunPreview({ frequency: 'WEEKLY', weekdays: [1], time: '08:00' }, now)).toBe('10-26 (월) 08:00');
    expect(nextRunPreview({ frequency: 'WEEKLY', weekdays: [], time: '08:00' }, now)).toBeNull();
  });
  it('PDF 이름', () => {
    expect(researchPdfName(12, 2)).toBe('심층조사-12-2판.pdf');
    expect(researchPdfName(12, null)).toBe('심층조사-12.pdf');
  });
});
