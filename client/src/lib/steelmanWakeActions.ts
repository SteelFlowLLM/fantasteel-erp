// 철강맨 부르기 (이슈 #457)에서 받아쓴 글로 하는 일: 부르는 말 처리, 명령, 말로 승인 실행, 화면 조작 켜기 확인.
// 마이크·화면은 features/shell/SteelmanWake.tsx가 맡고, 여기는 저장소와 API만 써서 시험에서 바로 부를 수 있다.
import { aiAssistantApi } from '@/api/aiAssistant';
import { errorCodeOf } from '@/api/http';
import { sttApi } from '@/api/stt';
import { controlAiAgent, sendAiAgentNote, stopAiAssistant } from '@/hooks/useAiAssistant';
import { CARD_RESULT, executeInputOf } from '@/lib/aiActionCard';
import { isLikelyHallucination, matchWakeWord, parseVoiceCommand, pickVoiceApprovalCard, resolveConfirmation, resolveVoiceApproval, VOICE_APPROVAL_MS, WAKE_FOLLOW_UP_MS, WAKE_REPLIES, type VoiceCommand } from '@/lib/steelmanWake';
import { playWakeChime, WAKE_CHIME_MS } from '@/lib/steelmanVoice';
import { useAiChatStore } from '@/stores/useAiChatStore';
import { useShellStore } from '@/stores/useShellStore';
import { useSteelmanWakeStore, voiceApprovalAllowed } from '@/stores/useSteelmanWakeStore';
import { errorMessageOf, toast } from '@/stores/useToastStore';

const store = () => useSteelmanWakeStore.getState();

/** 띠링을 울린 뒤 그 소리를 말로 잡지 않게 이때까지 듣기를 쉰다 */
let muteUntil = 0;
let audioContext: AudioContext | null = null;
let replyTurn = 0;

/** 마이크를 연 쪽이 띠링을 울릴 소리 판을 알려 준다. 닫으면 null */
export function setWakeAudioContext(context: AudioContext | null): void {
  audioContext = context;
}

export const wakeMuted = (now = Date.now()): boolean => now < muteUntil;

function chime(): void {
  muteUntil = Date.now() + WAKE_CHIME_MS + 150;
  if (audioContext) playWakeChime(audioContext);
}

/** 패널을 열고 그 사원의 지금 대화에 이어 묻는다. 답하는 중이면 브라우저·화면 조작 중일 때만 말을 덧붙인다 */
function ask(question: string): void {
  useShellStore.getState().showAiPanel();
  const chat = useAiChatStore.getState();
  if (!chat.pendingId) {
    store().requestPanel({ kind: 'ask', question });
    return;
  }
  if (chat.live?.control) {
    void sendAiAgentNote(question).then((sent) => store().notify(sent ? `작업 중인 철강맨AI에게 덧붙였어요: ${question}` : '말을 덧붙이지 못했어요'));
    return;
  }
  store().notify('답하는 중이에요. "철강맨, 멈춰"라고 하면 멈춰요');
}

function startApproval(index: number | null): void {
  if (!store().company.voiceApproval) {
    store().notify('관리자가 말로 승인을 꺼 두었어요. 화면에서 눌러 실행해 주세요');
    return;
  }
  if (!voiceApprovalAllowed(store())) {
    store().notify('말로 승인이 꺼져 있어요. 위 띠에서 "말로 승인 허용"을 켜거나 화면에서 눌러 실행해 주세요');
    return;
  }
  if (useAiChatStore.getState().pendingId) {
    store().notify('답을 다 받은 뒤에 실행해 주세요');
    return;
  }
  const picked = pickVoiceApprovalCard(useAiChatStore.getState().entries, index);
  if (!picked.ok) {
    store().notify(picked.reason);
    return;
  }
  useShellStore.getState().showAiPanel();
  chime();
  store().setApproval({ entryId: picked.entryId, ...(picked.messageId ? { messageId: picked.messageId } : {}), item: picked.item, deadline: Date.now() + VOICE_APPROVAL_MS });
}

/**
 * 확인 창의 카드를 손으로 누를 때와 같은 API로 실행한다. 서버가 권한을 다시 본다.
 * byVoice: "실행"이라고 말해서면 true(작업 로그 사유에 말로 승인이 남는다), 창의 [실행]을 눌렀으면 false.
 * 기다리는 사이 '말로 승인 허용'을 껐으면 말로는 실행하지 않는다. 같은 카드를 패널의 [실행]으로 이미 실행 중이면 그냥 돌아간다
 */
export async function executeApproved(byVoice: boolean): Promise<void> {
  const approval = store().approval;
  store().setApproval(null);
  if (!approval) return;
  if (byVoice && !voiceApprovalAllowed(store())) {
    store().notify('말로 승인이 꺼져 있어 실행하지 않았어요');
    return;
  }
  const chat = useAiChatStore.getState();
  const { key } = approval.item.card;
  // 기다리는 사이 패널에서 고친 값으로 실행한다
  const entry = chat.entries.find((item) => item.id === approval.entryId);
  const card = (entry?.role === 'assistant' ? entry.cards?.find((item) => item.card.key === key)?.card : undefined) ?? approval.item.card;
  if (!chat.claimCardRun(approval.entryId, key)) return;
  try {
    const result = await aiAssistantApi.executeActionCard({ ...executeInputOf(card), ...(byVoice ? { approvedByVoice: true as const } : {}), ...(approval.messageId ? { chat: { messageId: approval.messageId, cardKey: key } } : {}) });
    useAiChatStore.getState().updateCard(approval.entryId, key, { status: 'done', result: result.registered, running: false });
    toast.ok(CARD_RESULT[result.registered.type].message(result.registered));
  } catch (error) {
    useAiChatStore.getState().updateCard(approval.entryId, key, { running: false });
    toast.error(errorMessageOf(error));
  }
}

/** "화면 조작 켜"는 아무 목소리로나 켜지지 않게 한 번 더 확인한다. 끄기는 바로 한다 */
function startScreenControlConfirm(): void {
  useShellStore.getState().showAiPanel();
  chime();
  store().setScreenConfirm({ deadline: Date.now() + VOICE_APPROVAL_MS });
}

export function turnOnScreenControl(byVoice: boolean): void {
  store().setScreenConfirm(null);
  if (byVoice && !voiceApprovalAllowed(store())) {
    store().notify('말로 승인이 꺼져 있어 화면 조작을 켜지 않았어요. [켜기]를 눌러 주세요');
    return;
  }
  store().requestPanel({ kind: 'screenControl', on: true });
  store().notify('화면 조작을 켰어요');
}

function runCommand(command: Exclude<VoiceCommand, { kind: 'empty' }>, screenControlAvailable: boolean): void {
  const chat = useAiChatStore.getState();
  switch (command.kind) {
    case 'ask':
      ask(command.question);
      return;
    case 'stop':
      if (!chat.pendingId) store().notify('멈출 답이 없어요');
      else {
        stopAiAssistant();
        store().notify('답을 멈췄어요');
      }
      return;
    case 'pause':
    case 'resume':
      if (!chat.live?.control) store().notify('지금은 멈추거나 이어 갈 작업이 없어요 (브라우저·화면 조작 중일 때만)');
      else {
        void controlAiAgent(command.kind);
        store().notify(command.kind === 'pause' ? '잠깐 멈췄어요. "철강맨, 계속"이라고 하면 이어 가요' : '이어서 할게요');
      }
      return;
    case 'newChat':
      if (chat.pendingId) store().notify('답을 받는 중에는 새 대화를 시작할 수 없어요');
      else {
        chat.clear();
        useShellStore.getState().showAiPanel();
        store().notify('새 대화를 시작했어요');
      }
      return;
    case 'screenControl':
      if (!screenControlAvailable) store().notify('이 서버에서는 화면 조작을 쓸 수 없어요');
      else if (command.on) startScreenControlConfirm();
      else {
        store().requestPanel({ kind: 'screenControl', on: false });
        useShellStore.getState().showAiPanel();
        store().notify('화면 조작을 껐어요');
      }
      return;
    case 'approve':
      startApproval(command.index);
      return;
  }
}

/** 받아쓴 글 하나를 처리한다. 부르는 말도 없고 기다리던 말도 아니면 아무것도 남기지 않고 버린다 */
export function handleText(text: string, screenControlAvailable: boolean): void {
  const now = Date.now();
  const { approval, called, screenConfirm } = store();
  if (screenConfirm) {
    const outcome = resolveConfirmation(screenConfirm.deadline, text, now);
    if (outcome === 'execute') turnOnScreenControl(true);
    else {
      store().setScreenConfirm(null);
      store().notify(outcome === 'expired' ? '10초가 지나 화면 조작을 켜지 않았어요' : '화면 조작을 켜지 않았어요');
    }
    return;
  }
  if (approval) {
    const outcome = resolveVoiceApproval(approval, text, now);
    if (outcome === 'execute') void executeApproved(true);
    else {
      store().setApproval(null);
      store().notify(outcome === 'expired' ? '10초가 지나 실행하지 않았어요' : '실행하지 않았어요');
    }
    return;
  }
  const wake = matchWakeWord(text);
  const waiting = called !== null && now <= called.until;
  if (!wake.called && !(waiting && !isLikelyHallucination(text))) return;
  const command = parseVoiceCommand(wake.called ? wake.rest : text);
  if (command.kind === 'empty') {
    replyTurn += 1;
    chime();
    store().setCalled({ reply: WAKE_REPLIES[replyTurn % WAKE_REPLIES.length], until: now + WAKE_FOLLOW_UP_MS });
    return;
  }
  store().setCalled(null);
  runCommand(command, screenControlAvailable);
}

/** 조각 하나를 받아쓴다. 음성 서버에 닿지 않으면 스위치 옆에 이유를 보인다 */
export async function transcribe(wav: Blob, stopped: () => boolean, screenControlAvailable: () => boolean): Promise<void> {
  try {
    const result = await sttApi.transcribeWakeClip(wav);
    if (stopped()) return;
    if (result.error) {
      store().setProblem(`음성 서버가 꺼져 있어요 · ${result.error}`);
      return;
    }
    if (store().problem) store().setProblem(null);
    if (result.text) handleText(result.text, screenControlAvailable());
  } catch (error) {
    if (stopped()) return;
    if (errorCodeOf(error) === 'VOC-011') store().setCompany({ wake: false, voiceApproval: false });
    else if (errorCodeOf(error) === 'VOC-009') store().notify(errorMessageOf(error));
    else store().setProblem(errorMessageOf(error));
  }
}
