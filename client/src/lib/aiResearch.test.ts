import type { AiResearchEventView, AiResearchPlan, AiResearchRunView } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { addPlanStep, canCancelRun, inlineOf, isPlanChanged, mergeRunView, movePlanStep, nextAfterSeq, normalizePlan, progressText, removePlanStep, reportBlocks, shouldPollRun, sourceRows, stripSourceSection, timelineLineOf, validatePlan } from '@/lib/aiResearch';

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
  it('실패한 읽기·검색은 경고 톤', () => {
    expect(timelineLineOf({ seq: 3, type: 'page.read', createdAt: at, payload: { sourceId: 1, title: '', chars: 0, error: '시간 초과' } }).tone).toBe('wait');
    expect(timelineLineOf({ seq: 4, type: 'failed', createdAt: at, payload: { reason: '이유' } }).tone).toBe('danger');
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
  it('공백만 다른 수정은 바뀐 것이 아니다', () => {
    expect(isPlanChanged(plan, { ...plan, title: ' 조사 ' })).toBe(false);
    expect(isPlanChanged(plan, { ...plan, title: '다른' })).toBe(true);
    expect(normalizePlan({ title: ' a ', steps: [{ title: ' b', query: 'c ' }] })).toEqual({ title: 'a', steps: [{ title: 'b', query: 'c' }] });
  });
});

describe('진행 글', () => {
  it('단계와 출처를 분모와 함께 보인다', () => {
    expect(progressText({ stepsUsed: 3, budget: { maxSteps: 8, maxSources: 20 }, sources: [sources[0]] })).toBe('3/8 단계 · 출처 1/20');
  });
});
