// 철강맨 부르기 (이슈 #457) 리뷰 고침: 말로 승인·손으로 누름 구분, 두 번 실행 막기, 대기 중 허용을 끄면 실행 안 함, 화면 조작 켜기 확인.
import type { AiWorkCard } from '@fantasteel/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeApproved, handleText, transcribe } from '@/lib/steelmanWakeActions';
import { useAiChatStore, type AiChatEntry } from '@/stores/useAiChatStore';
import { useSteelmanWakeStore, voiceApprovalAllowed } from '@/stores/useSteelmanWakeStore';

const executeActionCard = vi.fn();
const transcribeWakeClip = vi.fn();
vi.mock('@/api/aiAssistant', () => ({ aiAssistantApi: { executeActionCard: (...args: unknown[]) => executeActionCard(...args) } }));
vi.mock('@/api/stt', () => ({ sttApi: { transcribeWakeClip: (...args: unknown[]) => transcribeWakeClip(...args) } }));
vi.mock('@/hooks/useAiAssistant', () => ({ controlAiAgent: vi.fn(), sendAiAgentNote: vi.fn(), stopAiAssistant: vi.fn() }));

const card: AiWorkCard = { key: 'k1', kind: 'TASK', title: '견적서 보내기', description: null, assigneeId: 7, assigneeName: null, dueDate: '2026-10-30', startAt: null, endAt: null, endAssumed: false, attendeeIds: [], purchase: null, itemName: null, issues: [] };
const answer: AiChatEntry = { id: 'e1', role: 'assistant', content: '', sources: [], messageId: 9, cards: [{ card, status: 'ready' }] };
const wake = () => useSteelmanWakeStore.getState();
const cardState = () => {
  const entry = useAiChatStore.getState().entries[0];
  return entry.role === 'assistant' ? entry.cards?.[0] : undefined;
};

beforeEach(() => {
  executeActionCard.mockReset().mockResolvedValue({ kind: 'TASK', registered: { type: 'task', id: 3 } });
  transcribeWakeClip.mockReset();
  useAiChatStore.setState({ entries: [answer], pendingId: null, live: null });
  useSteelmanWakeStore.setState({ employeeId: 1, enabled: true, voiceApproval: true, company: { wake: true, voiceApproval: true }, approval: null, screenConfirm: null, panelRequest: null, called: null, notice: null, problem: null });
});

const pendApproval = () => wake().setApproval({ entryId: 'e1', messageId: 9, item: { card, status: 'ready' }, deadline: Date.now() + 10_000 });

describe('말로 승인 실행', () => {
  it('"실행"이라고 말하면 approvedByVoice로 보내고 카드를 실행됨으로 바꾼다', async () => {
    pendApproval();
    handleText('실행', false);
    await vi.waitFor(() => expect(cardState()?.status).toBe('done'));
    expect(executeActionCard).toHaveBeenCalledWith(expect.objectContaining({ kind: 'TASK', approvedByVoice: true, chat: { messageId: 9, cardKey: 'k1' } }));
    expect(cardState()?.running).toBe(false);
  });

  it('창의 [실행]을 손으로 누르면 approvedByVoice 없이 보낸다', async () => {
    pendApproval();
    await executeApproved(false);
    expect(executeActionCard.mock.calls[0][0]).not.toHaveProperty('approvedByVoice');
  });

  it('기다리는 사이 말로 승인 허용을 끄면 말로는 실행하지 않는다 (누르면 된다)', async () => {
    pendApproval();
    useSteelmanWakeStore.setState({ voiceApproval: false });
    await executeApproved(true);
    expect(executeActionCard).not.toHaveBeenCalled();
    expect(wake().approval).toBeNull();
  });

  it('패널의 [실행]으로 이미 실행 중인 카드는 다시 보내지 않고, 실행 중에는 패널도 다시 잡지 못한다', async () => {
    useAiChatStore.getState().updateCard('e1', 'k1', { running: true });
    pendApproval();
    await executeApproved(true);
    expect(executeActionCard).not.toHaveBeenCalled();

    useAiChatStore.getState().updateCard('e1', 'k1', { running: false });
    let release: (value: unknown) => void = () => undefined;
    executeActionCard.mockReturnValue(new Promise((resolve) => (release = resolve)));
    pendApproval();
    const running = executeApproved(true);
    expect(useAiChatStore.getState().claimCardRun('e1', 'k1')).toBe(false);
    release({ kind: 'TASK', registered: { type: 'task', id: 3 } });
    await running;
    expect(executeActionCard).toHaveBeenCalledTimes(1);
    expect(useAiChatStore.getState().claimCardRun('e1', 'k1')).toBe(false);
  });

  it('실패하면 실행 중 표시를 풀어 다시 누를 수 있다', async () => {
    executeActionCard.mockRejectedValue(new Error('권한 없음'));
    pendApproval();
    await executeApproved(true);
    expect(cardState()).toMatchObject({ status: 'ready', running: false });
  });
});

describe('화면 조작 켜기 확인', () => {
  it('"화면 조작 켜"는 바로 켜지 않고 확인을 기다린다. 말로 승인 허용이면 "실행"으로 켠다', () => {
    handleText('철강맨, 화면 조작 켜 줘', true);
    expect(wake().panelRequest).toBeNull();
    expect(wake().screenConfirm).not.toBeNull();
    handleText('실행', true);
    expect(wake().panelRequest).toMatchObject({ kind: 'screenControl', on: true });
    expect(wake().screenConfirm).toBeNull();
  });

  it('말로 승인 허용이 꺼져 있으면 "실행"이라고 해도 켜지 않는다', () => {
    useSteelmanWakeStore.setState({ voiceApproval: false });
    handleText('철강맨, 화면 조작 켜', true);
    handleText('실행', true);
    expect(wake().panelRequest).toBeNull();
  });

  it('다른 말이면 켜지 않고, "꺼"는 확인 없이 바로 끈다', () => {
    handleText('철강맨 화면 조작 켜', true);
    handleText('아니', true);
    expect(wake().panelRequest).toBeNull();
    handleText('철강맨 화면 조작 꺼', true);
    expect(wake().panelRequest).toMatchObject({ kind: 'screenControl', on: false });
  });
});

describe('조각 받아쓰기', () => {
  it('끈 뒤에 돌아온 글은 처리하지 않는다', async () => {
    transcribeWakeClip.mockResolvedValue({ text: '철강맨, 재고 알려줘', error: null });
    await transcribe(new Blob(), () => true, () => false);
    expect(wake().panelRequest).toBeNull();
    await transcribe(new Blob(), () => false, () => false);
    expect(wake().panelRequest).toMatchObject({ kind: 'ask', question: '재고 알려줘' });
  });

  it('음성 서버 문제는 띠에 보인다', async () => {
    transcribeWakeClip.mockResolvedValue({ text: null, error: '음성 서버에 연결할 수 없어요' });
    await transcribe(new Blob(), () => false, () => false);
    expect(wake().problem).toContain('음성 서버에 연결할 수 없어요');
  });
});

describe('회사 설정 (AI 연결 화면)', () => {
  it('말로 승인은 회사와 사원이 둘 다 켰을 때만', () => {
    expect(voiceApprovalAllowed({ voiceApproval: true, company: { wake: true, voiceApproval: true } })).toBe(true);
    expect(voiceApprovalAllowed({ voiceApproval: true, company: { wake: true, voiceApproval: false } })).toBe(false);
    expect(voiceApprovalAllowed({ voiceApproval: false, company: { wake: true, voiceApproval: true } })).toBe(false);
  });

  it('회사가 말로 승인을 꺼 두면 카드 창을 띄우지 않고, 기다리던 창도 거두며, 말로는 실행하지 않는다', async () => {
    useSteelmanWakeStore.setState({ company: { wake: true, voiceApproval: false } });
    handleText('철강맨, 이거 실행해줘', false);
    expect(wake().approval).toBeNull();
    expect(wake().notice?.text).toContain('관리자가 말로 승인을 꺼 두었어요');

    useSteelmanWakeStore.setState({ company: { wake: true, voiceApproval: true } });
    pendApproval();
    wake().setCompany({ wake: true, voiceApproval: false });
    expect(wake().approval).toBeNull();
    pendApproval();
    await executeApproved(true);
    expect(executeActionCard).not.toHaveBeenCalled();
  });

  it('회사가 말로 승인을 꺼도 사원 각자의 켜기 설정은 남는다', () => {
    wake().setCompany({ wake: true, voiceApproval: false });
    expect(wake().voiceApproval).toBe(true);
    expect(wake().enabled).toBe(true);
  });

  it('서버가 관리자가 껐다고 하면(VOC-011) 회사 설정을 꺼서 마이크를 닫게 한다', async () => {
    transcribeWakeClip.mockRejectedValue(Object.assign(new Error('관리자가 철강맨 부르기를 꺼 두었어요'), { code: 'VOC-011' }));
    await transcribe(new Blob(), () => false, () => false);
    expect(wake().company).toEqual({ wake: false, voiceApproval: false });
    expect(wake().status).toBe('off');
  });
});
