// 접힌 '생각 과정' 요약 문구.
import { describe, expect, it } from 'vitest';
import { aiStepsSummary, toolTitleOf } from '@/features/shell/AiAnswerTrace';

describe('aiStepsSummary', () => {
  it('생각한 초와 조회한 횟수를 보인다', () => {
    expect(
      aiStepsSummary([
        { kind: 'thinking', text: '음', startedAt: 1000, endedAt: 9000 },
        { kind: 'tool', id: 'a', name: 'get_inventory', arguments: '{}', result: null },
        { kind: 'note', text: '조회할게요' },
        { kind: 'tool', id: 'b', name: 'trace_lot', arguments: '{}', result: null },
      ]),
    ).toBe('생각 과정 보기 · 생각 8초 · 조회 2번');
  });

  it('쓰기 도구는 조회가 아니라 실행 요청으로 센다', () => {
    expect(
      aiStepsSummary([
        { kind: 'tool', id: 'a', name: 'get_inventory', arguments: '{}', result: null },
        { kind: 'tool', id: 'b', name: 'add_my_schedule_event', arguments: '{}', result: null },
      ]),
    ).toBe('생각 과정 보기 · 조회 1번 · 실행 요청 1번');
  });

  it('생각 시간을 모르면 생략하고, 조회가 없으면 조회를 생략한다', () => {
    expect(aiStepsSummary([{ kind: 'thinking', text: '음', startedAt: 0, endedAt: 0 }])).toBe('생각 과정 보기');
    expect(aiStepsSummary([{ kind: 'thinking', text: '음', startedAt: 0, endedAt: 400 }])).toBe('생각 과정 보기 · 생각 1초');
  });
});

describe('toolTitleOf', () => {
  it('한글 제목이 있으면 그것을, 모르는 도구는 이름 그대로 보인다', () => {
    expect(toolTitleOf('get_inventory')).toBe('재고 조회');
    expect(toolTitleOf('new_tool')).toBe('new_tool');
  });
});
