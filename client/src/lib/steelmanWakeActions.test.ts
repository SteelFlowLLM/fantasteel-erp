// 철강맨 부르기 (이슈 #457) 리뷰 고침: 말로 승인·손으로 누름 구분, 두 번 실행 막기, 대기 중 허용을 끄면 실행 안 함, 화면 조작 켜기 확인.
import type { AiWorkCard } from '@fantasteel/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeApproved, flushCommandPrefix, handleText, transcribe } from '@/lib/steelmanWakeActions';
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

describe('띠에 보이는 단계 (이슈 #494)', () => {
  beforeEach(() => useSteelmanWakeStore.setState({ activity: null, transcribing: false, approval: null, screenConfirm: null, called: null }));

  it('부르는 말이 없는 글은 들은 말로 잠깐 보이고(넘김), 부르는 말이면 불렀어요와 대답을 보인다', () => {
    handleText('점심 뭐 먹지', false);
    expect(wake().activity).toMatchObject({ kind: 'heard', text: '점심 뭐 먹지', matched: false });
    expect(wake().called).toBeNull();
    handleText('철강맨', false);
    expect(wake().activity).toMatchObject({ kind: 'heard', matched: true });
    expect(wake().called?.reply).toBeTruthy();
  });

  it('질문을 패널로 보내면 물어보는 중을 보인다', () => {
    handleText('철강맨, 오늘 내 일정 알려줘', false);
    expect(wake().activity).toMatchObject({ kind: 'asking', question: '오늘 내 일정 알려줘' });
    expect(wake().panelRequest).toMatchObject({ kind: 'ask', question: '오늘 내 일정 알려줘' });
  });

  it('받아쓰는 동안 transcribing이고, 끝나거나 실패하면 내린다', async () => {
    let finish: (value: { text: string; error: null }) => void = () => undefined;
    transcribeWakeClip.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const done = transcribe(new Blob(), () => false, () => false);
    expect(wake().transcribing).toBe(true);
    finish({ text: '', error: null });
    await done;
    expect(wake().transcribing).toBe(false);
    transcribeWakeClip.mockRejectedValueOnce(new Error('끊김'));
    await transcribe(new Blob(), () => false, () => false);
    expect(wake().transcribing).toBe(false);
  });
});

describe('긴 명령·이어 말하기 (이슈 #494)', () => {
  beforeEach(() => useSteelmanWakeStore.setState({ activity: null, transcribing: false, approval: null, screenConfirm: null, called: null, commandPrefix: null, partialText: null, panelRequest: null }));
  const cut = { mode: 'wake' as const, truncated: true };
  const command = (truncated = false) => ({ mode: 'command' as const, truncated });

  it('"철강맨, …"이 8초에서 잘리면 나머지를 이어 붙여 한 질문으로 묻는다', () => {
    handleText('철강맨, 이번 주 열연 생산 계획에서 SS275 재고가 얼마나', false, cut);
    expect(wake().commandPrefix?.text).toBe('이번 주 열연 생산 계획에서 SS275 재고가 얼마나');
    expect(wake().panelRequest).toBeNull();
    // 나머지가 또 잘리면 더 이어 붙인다
    handleText('남았는지 알려 주고', false, command(true));
    expect(wake().panelRequest).toBeNull();
    handleText('다음 주 납기도 정리해 줘', false, command());
    expect(wake().commandPrefix).toBeNull();
    expect(wake().panelRequest).toMatchObject({ kind: 'ask', question: '이번 주 열연 생산 계획에서 SS275 재고가 얼마나 남았는지 알려 주고 다음 주 납기도 정리해 줘' });
  });

  it('잘린 뒤 말이 더 없으면 들은 데까지 묻는다', () => {
    handleText('철강맨, 오늘 출하 예정 알려', false, cut);
    flushCommandPrefix(false);
    expect(wake().panelRequest).toMatchObject({ question: '오늘 출하 예정 알려' });
  });

  it('"철강맨"만 부른 뒤 마감을 넘겨 끝난 명령 덩어리도 질문으로 받는다', () => {
    wake().setCalled({ reply: '네?', until: Date.now() - 1_000 });
    handleText('어제 불합격 LOT 몇 개야', false, command());
    expect(wake().panelRequest).toMatchObject({ question: '어제 불합격 LOT 몇 개야' });
  });

  it('이어 말하기: 부르는 말 없이 다음 질문을 받고, "고마워·그만·됐어"면 끝낸다', () => {
    wake().setCalled({ reply: '이어서', until: Date.now() + 10_000, followUp: true });
    handleText('그럼 내일은?', false, command());
    expect(wake().panelRequest).toMatchObject({ question: '그럼 내일은?' });
    for (const end of ['고마워', '그만', '됐어요', '철강맨 고마워']) {
      wake().setCalled({ reply: '이어서', until: Date.now() + 10_000, followUp: true });
      useSteelmanWakeStore.setState({ panelRequest: null });
      handleText(end, false, command());
      expect(wake().called).toBeNull();
      expect(wake().panelRequest).toBeNull();
    }
  });

  it('받아쓰기에 조각 종류를 함께 보낸다', async () => {
    transcribeWakeClip.mockResolvedValueOnce({ text: '', error: null });
    await transcribe(new Blob(), () => false, () => false, command());
    expect(transcribeWakeClip).toHaveBeenCalledWith(expect.any(Blob), 'command');
  });
});
