// 철강맨 부르기 (이슈 #457)에서 받아쓴 글로 하는 일: 부르는 말 처리, 명령, 말로 승인 실행, 화면 조작 켜기 확인,
// 말로 물은 답을 읽어 주기와 읽는 동안 듣기 쉬기(이슈 #507).
// 마이크·화면은 features/shell/SteelmanWake.tsx가 맡고, 여기는 저장소와 API만 써서 시험에서 바로 부를 수 있다.
import { aiAssistantApi } from '@/api/aiAssistant';
import { errorCodeOf } from '@/api/http';
import { sttApi } from '@/api/stt';
import { controlAiAgent, sendAiAgentNote, stopAiAssistant } from '@/hooks/useAiAssistant';
import { CARD_RESULT, executeInputOf } from '@/lib/aiActionCard';
import {
  COMMAND_CONTINUE_MS,
  CONVERSATION_FOLLOW_UP_MS,
  FOLLOW_UP_REPLY,
  compactSpeech,
  isConversationEnd,
  isLikelyHallucination,
  matchWakeWord,
  parseVoiceCommand,
  pickVoiceApprovalCard,
  resolveConfirmation,
  resolveVoiceApproval,
  VOICE_APPROVAL_MS,
  WAKE_FOLLOW_UP_MS,
  WAKE_REPLIES,
  type VoiceCommand,
} from '@/lib/steelmanWake';
import { setWakeLiveLevel } from '@/lib/wakeOrb';
import type { VoiceSegmenter, VoiceSegmentMode } from '@/lib/voiceClip';
import { playWakeChime, speakSteelmanReply, WAKE_CHIME_MS, type SteelmanSpeakRequest } from '@/lib/steelmanVoice';
import { speak, speechMuted, speechSupport, SPEECH_SAMPLE_KEY, stopSpeaking, useSteelmanSpeechStore } from '@/lib/steelmanSpeech';
import { speechTextOf } from '@/lib/steelmanSpeechText';
import { useAiChatStore, type AiChatEntry } from '@/stores/useAiChatStore';
import { useShellStore } from '@/stores/useShellStore';
import { useSteelmanWakeStore, voiceApprovalAllowed } from '@/stores/useSteelmanWakeStore';
import { errorMessageOf, toast } from '@/stores/useToastStore';

const store = () => useSteelmanWakeStore.getState();

/** 받아쓴 조각의 성격: 부르는 말 조각인지 명령 덩어리인지, 최대 길이에서 잘려 말이 이어지는지 (이슈 #494) */
export interface HeardClip {
  mode: VoiceSegmentMode;
  truncated: boolean;
}

const WHOLE_WAKE_CLIP: HeardClip = { mode: 'wake', truncated: false };

/** 띠링을 울린 뒤 그 소리를 말로 잡지 않게 이때까지 듣기를 쉰다 */
let muteUntil = 0;
let audioContext: AudioContext | null = null;
let replyTurn = 0;

/** 마이크를 연 쪽이 띠링을 울릴 소리 판을 알려 준다. 닫으면 null */
export function setWakeAudioContext(context: AudioContext | null): void {
  audioContext = context;
}

/** 띠링을 울린 직후이거나, 철강맨이 답을 읽는 중(막 끝나 울림이 남은 때 포함)이면 마이크가 소리를 말로 잡지 않는다 (이슈 #507) */
export const wakeMuted = (now = Date.now()): boolean => now < muteUntil || speechMuted(now);

/**
 * 마이크 소리 묶음 하나를 받기 전에 부른다. 쉬는 중(띠링·읽는 중)이면 true: 하던 말과 미리 담아 둔 소리(preRoll)를 버리고
 * 말소리 잡는 표시·소리 크기를 끈다. 그래서 쉬는 동안 조각이 나오지 않고, 풀린 뒤에는 쉬기 전의 소리가 앞에 붙지 않는다 (이슈 #507)
 */
export function restMicIfMuted(segmenter: VoiceSegmenter, now = Date.now()): boolean {
  if (!wakeMuted(now)) return false;
  segmenter.reset();
  if (store().hearing) store().setHearing(false);
  setWakeLiveLevel(0, segmenter.startThreshold);
  return true;
}

function chime(): void {
  muteUntil = Date.now() + WAKE_CHIME_MS + 150;
  if (audioContext) playWakeChime(audioContext);
}

/** 패널을 열고 그 사원의 지금 대화에 이어 묻는다. 답하는 중이면 브라우저·화면 조작 중일 때만 말을 덧붙인다 */
function ask(question: string): void {
  useShellStore.getState().showAiPanel();
  const chat = useAiChatStore.getState();
  if (!chat.pendingId) {
    store().showActivity({ kind: 'asking', question });
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
    const result = await aiAssistantApi.executeActionCard({ ...executeInputOf(card), ...(card.cardId ? { cardId: card.cardId } : {}), ...(byVoice ? { approvedByVoice: true as const } : {}), ...(approval.messageId ? { chat: { messageId: approval.messageId, cardKey: key } } : {}) });
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
      // 읽는 중이면 읽기를 멈춘다. 읽는 동안 마이크는 쉬므로 이 말이 오는 것은 읽기 직전에 한 말이 읽기 시작 뒤에 받아써져 도착한 때뿐이다
      if (stopSpeaking('stopped')) store().notify('읽기를 멈췄어요');
      else if (!chat.pendingId) store().notify('멈출 답이 없어요');
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

/** 부르는 말 없이 받은 명령 글을 처리한다 (잘렸다 이어 붙인 명령) */
function runText(text: string, screenControlAvailable: boolean): void {
  const command = parseVoiceCommand(text);
  if (command.kind === 'empty') return;
  store().setCalled(null);
  runCommand(command, screenControlAvailable);
}

/** 최대 길이에서 잘린 명령의 나머지를 더 기다리지 않고 들은 데까지 묻는다 (조용해졌거나 기다림이 끝남) */
export function flushCommandPrefix(screenControlAvailable: boolean): void {
  const prefix = store().commandPrefix;
  if (!prefix) return;
  store().setCommandPrefix(null);
  runText(prefix.text, screenControlAvailable);
}

/**
 * 받아쓴 글 하나를 처리한다. 부르는 말도 없고 기다리던 말도 아니면 아무것도 남기지 않고 버린다.
 * clip(이슈 #494): 최대 길이에서 잘린 조각이면 말이 이어지므로 나머지를 받아 이어 붙여 묻는다
 */
export function handleText(text: string, screenControlAvailable: boolean, clip: HeardClip = WHOLE_WAKE_CLIP): void {
  const now = Date.now();
  store().setPartialText(null);
  const { approval, called, screenConfirm, commandPrefix } = store();
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
  // 잘린 명령의 나머지: 앞부분에 이어 붙인다 (부르는 말이 없어도 된다)
  if (commandPrefix) {
    const joined = `${commandPrefix.text} ${text}`.trim();
    if (clip.truncated) {
      store().setCommandPrefix({ text: joined, until: now + COMMAND_CONTINUE_MS });
      return;
    }
    store().setCommandPrefix(null);
    runText(joined, screenControlAvailable);
    return;
  }
  const wake = matchWakeWord(text);
  // 기다리는 동안 시작한 말(명령 덩어리)은 길어져 마감을 넘겨도 받는다
  const waiting = called !== null && (now <= called.until || clip.mode === 'command');
  // 이어 말하기 중 "그만·고마워·됐어"면 대화를 끝낸다
  if (waiting && called.followUp && isConversationEnd(text)) {
    store().setCalled(null);
    store().notify('알겠어요. 필요하면 "철강맨"으로 다시 불러 주세요');
    return;
  }
  if (!wake.called && !(waiting && !isLikelyHallucination(text))) {
    // 무엇을 들었는지 띠에 몇 초만 보인다 (이슈 #494). 서버·저장소에는 남기지 않는다
    store().showActivity({ kind: 'heard', text, matched: false });
    return;
  }
  store().showActivity({ kind: 'heard', text, matched: true });
  const rest = wake.called ? wake.rest : text;
  // "철강맨, …"이 8초에서 잘렸으면 나머지를 같은 명령으로 이어 받는다 (명령 듣기로 바꿔 끝까지 듣는다)
  if (clip.truncated && compactSpeech(rest)) {
    store().setCalled(null);
    store().setCommandPrefix({ text: rest, until: now + COMMAND_CONTINUE_MS });
    return;
  }
  const command = parseVoiceCommand(rest);
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
export async function transcribe(wav: Blob, stopped: () => boolean, screenControlAvailable: () => boolean, clip: HeardClip = WHOLE_WAKE_CLIP): Promise<void> {
  store().setTranscribing(true);
  try {
    const result = await sttApi.transcribeWakeClip(wav, clip.mode);
    store().setTranscribing(false);
    if (stopped()) return;
    if (result.error) {
      store().setProblem(`음성 서버가 꺼져 있어요 · ${result.error}`);
      return;
    }
    if (store().problem) store().setProblem(null);
    if (result.text) handleText(result.text, screenControlAvailable(), clip);
    // 잘린 명령의 나머지가 말이 아니었으면(빈 글) 들은 데까지 묻는다
    else if (!clip.truncated && store().commandPrefix) flushCommandPrefix(screenControlAvailable());
  } catch (error) {
    store().setTranscribing(false);
    if (stopped()) return;
    if (errorCodeOf(error) === 'VOC-011') store().setCompany({ wake: false, voiceApproval: false });
    else if (errorCodeOf(error) === 'VOC-009') store().notify(errorMessageOf(error));
    else store().setProblem(errorMessageOf(error));
  }
}

let partialInFlight = false;

/**
 * 명령을 말하는 동안 지금까지의 덩어리를 받아써 띠에 보인다 (이슈 #494, 보이기만 하고 명령으로 쓰지 않는다).
 * 한 번에 하나만 보내고, 실패는 조용히 넘긴다(최종 덩어리가 따로 간다)
 */
export async function transcribePartial(wav: Blob, stopped: () => boolean): Promise<void> {
  if (partialInFlight) return;
  partialInFlight = true;
  try {
    const result = await sttApi.transcribeWakeClip(wav, 'partial');
    if (!stopped() && store().hearing && result.text) store().setPartialText(result.text);
  } catch {
    // 한도(VOC-009)·연결 실패: 중간 글만 못 보일 뿐이다
  } finally {
    partialInFlight = false;
  }
}

let speechUnavailableNoticed = false;

/** 시험에서 '한 번만 알림'을 되돌린다 */
export function resetSpeechNoticeForTest(): void {
  speechUnavailableNoticed = false;
}

/** 읽어 주기가 켜져 있는데 이 브라우저가 읽지 못할 때 이유를 한 번만 띠에 보인다 (설정에도 같은 안내가 있다) */
function noticeSpeechUnavailable(): void {
  const support = speechSupport();
  if (support === 'ready' || speechUnavailableNoticed) return;
  speechUnavailableNoticed = true;
  store().notify(support === 'unsupported' ? '이 브라우저는 소리 내 읽기를 지원하지 않아 글로만 답해요' : '이 브라우저에 한국어 목소리가 없어 글로만 답해요. 읽어 주기 설정을 봐 주세요');
}

/** 철강맨 부르기로 물은 답을 브라우저 음성으로 읽는다 (setSteelmanSpeaker에 꽂는 1단계 목소리). 읽기 시작하면 true */
export function speakVoiceReply(request: SteelmanSpeakRequest): boolean {
  const { voiceUri, speechRate } = store();
  return speak({ key: request.key, text: speechTextOf(request.text).text, source: 'voice', voiceUri, rate: speechRate, onDone: request.onDone });
}

/**
 * 말로 물은 질문의 답이 끝났을 때 한다: 띠에 '답했어요', 읽어 주기가 켜져 있으면 읽고(그동안 듣기는 쉰다),
 * 이어 말하기(부르는 말 없이 다음 질문 받기)는 다 읽은 뒤부터 센다. 읽지 않으면 바로 센다.
 * 읽는 중 새 질문이나 부르기 끄기가 가로채면(interrupted) 이어 말하기를 열지 않는다
 */
export function afterVoiceAnswer(last: AiChatEntry | undefined): void {
  store().showActivity({ kind: 'answered' });
  const followUp = (): void => {
    if (!store().enabled || !store().company.wake) return;
    store().setCalled({ reply: FOLLOW_UP_REPLY, until: Date.now() + CONVERSATION_FOLLOW_UP_MS, followUp: true });
  };
  if (last?.role !== 'assistant' || !last.content.trim() || !store().speak) {
    followUp();
    return;
  }
  const started = speakSteelmanReply({
    key: last.id,
    text: last.content,
    onDone: (outcome) => {
      if (outcome === 'failed') store().notify('브라우저가 소리를 막았어요. 화면을 한 번 누른 뒤 다시 해 주세요');
      if (outcome !== 'interrupted') followUp();
    },
  });
  if (started) return;
  noticeSpeechUnavailable();
  followUp();
}

/** 답의 읽기·멈춤 단추: 이 답을 읽는 중이면 멈추고, 아니면 읽는다. 읽어 주기 설정이 꺼져 있어도 누르면 읽는다. 읽을 수 없으면 'unavailable' */
export function toggleReadAloud(key: string, content: string): 'started' | 'stopped' | 'unavailable' {
  if (useSteelmanSpeechStore.getState().speaking?.key === key) {
    stopSpeaking('stopped');
    return 'stopped';
  }
  const { voiceUri, speechRate } = store();
  return speak({ key, text: speechTextOf(content).text, source: 'button', voiceUri, rate: speechRate }) ? 'started' : 'unavailable';
}

const SPEECH_SAMPLE = '안녕하세요, 철강맨이에요. 이 목소리로 답을 읽어 드려요.';

/** 설정의 [들어 보기]: 고른 목소리·빠르기로 짧은 글을 읽는다. 읽는 중에 다시 누르면 멈춘다 */
export function toggleSpeechSample(): 'started' | 'stopped' | 'unavailable' {
  if (useSteelmanSpeechStore.getState().speaking?.key === SPEECH_SAMPLE_KEY) {
    stopSpeaking('stopped');
    return 'stopped';
  }
  const { voiceUri, speechRate } = store();
  return speak({ key: SPEECH_SAMPLE_KEY, text: SPEECH_SAMPLE, source: 'button', voiceUri, rate: speechRate }) ? 'started' : 'unavailable';
}

/**
 * 읽는 도중 읽기를 끊어야 하는 일을 지켜본다: 새 질문이 시작됨(손으로 쓰든 말로 하든), 읽던 답이 사라짐(새 대화·다른 대화·다른 사원),
 * 부르기 끄기(부르기로 읽던 것만). 끊으면 interrupted라 이어 말하기를 열지 않는다. 돌려주는 함수는 지켜보기를 그만두고 읽던 것을 끊는다
 */
export function watchSteelmanSpeech(): () => void {
  const offChat = useAiChatStore.subscribe((state, previous) => {
    const speaking = useSteelmanSpeechStore.getState().speaking;
    if (!speaking) return;
    const newQuestion = state.pendingId !== null && previous.pendingId === null;
    const answerGone = speaking.key !== SPEECH_SAMPLE_KEY && !state.entries.some((entry) => entry.id === speaking.key);
    if (newQuestion || answerGone) stopSpeaking('interrupted');
  });
  const offWake = useSteelmanWakeStore.subscribe((state, previous) => {
    if (useSteelmanSpeechStore.getState().speaking?.source !== 'voice') return;
    if (previous.enabled && previous.company.wake && !(state.enabled && state.company.wake)) stopSpeaking('interrupted');
  });
  return () => {
    offChat();
    offWake();
    stopSpeaking('interrupted');
  };
}
