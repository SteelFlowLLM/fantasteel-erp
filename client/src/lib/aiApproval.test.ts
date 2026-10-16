// 승인 카드 상태: 서버 이벤트로만 바뀌고, 멈추면 고르던 카드는 거부됨으로 닫힌다.
import type { AiAssistantStreamEvent } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import {
  aiApprovalCountdownText,
  aiApprovalResolutionText,
  aiApprovalsForTool,
  aiApprovalsWithoutTool,
  isInternalLinkPath,
  reduceAiApprovals,
  setAiApprovalSending,
  settleAiApprovalsOnDisconnect,
  type AiApprovalCard,
} from '@/lib/aiApproval';

const REQUIRED: AiAssistantStreamEvent = {
  type: 'approval_required',
  approvalId: 'a1',
  toolId: 't1',
  toolName: 'add_my_schedule_event',
  title: '내 일정 추가: 주간 회의',
  details: [{ label: '날짜', value: '2026-10-19 (월)' }],
  expiresAt: '2026-10-16T10:10:00.000Z',
};

const fold = (events: AiAssistantStreamEvent[]): AiApprovalCard[] => events.reduce<AiApprovalCard[]>((cards, event) => reduceAiApprovals(cards, event), []);

describe('reduceAiApprovals', () => {
  it('approval_required로 카드가 생기고 도구 호출(toolId)과 이어진다', () => {
    const cards = fold([REQUIRED]);
    expect(cards).toEqual([
      { approvalId: 'a1', toolId: 't1', toolName: 'add_my_schedule_event', title: '내 일정 추가: 주간 회의', details: REQUIRED.type === 'approval_required' ? REQUIRED.details : [], expiresAt: '2026-10-16T10:10:00.000Z', sending: null, resolution: null, execution: null, interrupted: false },
    ]);
    expect(aiApprovalsForTool(cards, 't1')).toHaveLength(1);
    expect(aiApprovalsForTool(cards, 'other')).toHaveLength(0);
    expect(aiApprovalsWithoutTool(cards, new Set(['t1']))).toHaveLength(0);
    expect(aiApprovalsWithoutTool(cards, new Set())).toHaveLength(1);
  });

  it('같은 approvalId가 다시 와도 카드를 늘리지 않는다', () => {
    expect(fold([REQUIRED, REQUIRED])).toHaveLength(1);
  });

  it('허용을 보내는 중에는 서버가 approval_resolved를 보내기 전까지 끝나지 않고, 이벤트가 오면 보내는 중이 풀린다', () => {
    let cards = fold([REQUIRED]);
    cards = setAiApprovalSending(cards, 'a1', 'ALLOW');
    expect(cards[0]).toMatchObject({ sending: 'ALLOW', resolution: null });
    cards = reduceAiApprovals(cards, { type: 'approval_resolved', approvalId: 'a1', decision: 'ALLOW' });
    expect(cards[0]).toMatchObject({ sending: null, resolution: 'ALLOW' });
  });

  it('이미 끝난 카드는 보내는 중으로 되돌리지 않는다', () => {
    const cards = fold([REQUIRED, { type: 'approval_resolved', approvalId: 'a1', decision: 'TIMEOUT' }]);
    expect(setAiApprovalSending(cards, 'a1', 'ALLOW')[0].sending).toBeNull();
  });

  it('tool_execution이 실행 결과를 카드에 붙인다. 모르는 카드의 이벤트는 건너뛴다', () => {
    const cards = fold([
      REQUIRED,
      { type: 'approval_resolved', approvalId: 'a1', decision: 'ALLOW' },
      { type: 'tool_execution', approvalId: 'a1', status: 'SUCCESS', message: '일정을 추가했어요', result: { table: 'schedule_event', id: 31, label: '주간 회의', linkPath: '/schedule?week=2026-10-19' }, attempts: 1 },
      { type: 'approval_resolved', approvalId: 'zzz', decision: 'DENY' },
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].execution).toEqual({ status: 'SUCCESS', message: '일정을 추가했어요', result: { table: 'schedule_event', id: 31, label: '주간 회의', linkPath: '/schedule?week=2026-10-19' }, attempts: 1 });
  });

  it('다른 종류의 이벤트는 카드를 바꾸지 않는다', () => {
    const cards = fold([REQUIRED]);
    expect(reduceAiApprovals(cards, { type: 'answer', text: '가' })).toEqual(cards);
  });
});

describe('settleAiApprovalsOnDisconnect', () => {
  it('고르던 카드는 거부됨으로 닫고, 허용했지만 결과를 못 받은 카드는 끊김으로 표시한다', () => {
    const pending = fold([REQUIRED]);
    expect(settleAiApprovalsOnDisconnect(setAiApprovalSending(pending, 'a1', 'ALLOW'))[0]).toMatchObject({ resolution: 'DENY', sending: null, interrupted: false });

    const allowed = fold([REQUIRED, { type: 'approval_resolved', approvalId: 'a1', decision: 'ALLOW' }]);
    expect(settleAiApprovalsOnDisconnect(allowed)[0]).toMatchObject({ resolution: 'ALLOW', execution: null, interrupted: true });
  });

  it('이미 끝난 카드는 그대로 둔다', () => {
    const done = fold([REQUIRED, { type: 'approval_resolved', approvalId: 'a1', decision: 'TIMEOUT' }]);
    expect(settleAiApprovalsOnDisconnect(done)).toEqual(done);
  });
});

describe('aiApprovalResolutionText', () => {
  it('공통 라벨로 허용됨·거부됨, 시간 초과는 시간이 지나 거부됨', () => {
    expect(aiApprovalResolutionText('ALLOW')).toBe('허용됨');
    expect(aiApprovalResolutionText('DENY')).toBe('거부됨');
    expect(aiApprovalResolutionText('TIMEOUT')).toBe('시간이 지나 거부됨');
  });
});

describe('aiApprovalCountdownText', () => {
  const expiresAt = '2026-10-16T10:10:00.000Z';
  const at = (iso: string) => Date.parse(iso);

  it('1분 이상 남으면 올림한 분으로 보인다', () => {
    expect(aiApprovalCountdownText(expiresAt, at('2026-10-16T10:00:00.000Z'))).toBe('10분 안에 결정');
    expect(aiApprovalCountdownText(expiresAt, at('2026-10-16T10:00:30.000Z'))).toBe('10분 안에 결정');
    expect(aiApprovalCountdownText(expiresAt, at('2026-10-16T10:08:10.000Z'))).toBe('2분 안에 결정');
  });

  it('1분 밑이면 초로, 지났으면 안내를, 읽을 수 없으면 빈 문구를 보인다', () => {
    expect(aiApprovalCountdownText(expiresAt, at('2026-10-16T10:09:18.500Z'))).toBe('42초 안에 결정');
    expect(aiApprovalCountdownText(expiresAt, at('2026-10-16T10:10:00.000Z'))).toBe('결정할 시간이 지났어요');
    expect(aiApprovalCountdownText('not a date', 0)).toBe('');
  });
});

describe('isInternalLinkPath', () => {
  it('앱 안의 경로만 링크로 만든다', () => {
    expect(isInternalLinkPath('/schedule?week=2026-10-19')).toBe(true);
    expect(isInternalLinkPath('/action-drafts/12')).toBe(true);
    expect(isInternalLinkPath('//evil.example')).toBe(false);
    expect(isInternalLinkPath('https://evil.example')).toBe(false);
    expect(isInternalLinkPath('/\\evil.example')).toBe(false);
    expect(isInternalLinkPath('')).toBe(false);
  });
});
