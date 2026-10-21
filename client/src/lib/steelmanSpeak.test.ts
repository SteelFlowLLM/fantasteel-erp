// 철강맨 말하기 1단계 (이슈 #507): 말로 물은 답을 읽고, 읽는 동안 듣기를 쉬고, 다 읽은 뒤부터 이어 말하기를 세며,
// 읽기 단추·멈춤·설정이 제대로 먹는지 본다. 브라우저 음성은 가짜(test/fakeSpeech.ts), 마이크는 wakeMuted()로 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONVERSATION_FOLLOW_UP_MS } from '@/lib/steelmanWake';
import { SPEECH_TAIL_MS, stopSpeaking, useSteelmanSpeechStore } from '@/lib/steelmanSpeech';
import { setSteelmanSpeaker } from '@/lib/steelmanVoice';
import { SPEAK_MORE_ON_SCREEN } from '@/lib/steelmanSpeechText';
import { afterVoiceAnswer, handleText, resetSpeechNoticeForTest, speakVoiceReply, toggleReadAloud, toggleSpeechSample, wakeMuted, watchSteelmanSpeech } from '@/lib/steelmanWakeActions';
import { steelmanWakeKeyOf } from '@/lib/steelmanWakePreference';
import { useAiChatStore, type AiChatEntry } from '@/stores/useAiChatStore';
import { useSteelmanWakeStore } from '@/stores/useSteelmanWakeStore';
import { FakeSpeech, voice } from '@/test/fakeSpeech';

vi.mock('@/api/aiAssistant', () => ({ aiAssistantApi: { executeActionCard: vi.fn() } }));
vi.mock('@/api/stt', () => ({ sttApi: { transcribeWakeClip: vi.fn() } }));
const stopAiAssistant = vi.fn();
vi.mock('@/hooks/useAiAssistant', () => ({ controlAiAgent: vi.fn(), sendAiAgentNote: vi.fn(), stopAiAssistant: () => stopAiAssistant() }));

const wake = () => useSteelmanWakeStore.getState();
const answer: AiChatEntry = { id: 'e1', role: 'assistant', content: '열연 코일 재고는 **12.500톤**이에요.\n\n| 로트 | 톤 |\n|---|---|\n| HR-01 | 12.5 |', sources: [] };
const question: AiChatEntry = { id: 'q1', role: 'user', content: '재고 알려줘' };

let fake: FakeSpeech;
let clock = Date.now();
let unwatch: () => void = () => undefined;

beforeEach(() => {
  vi.useFakeTimers();
  clock += 3_600_000;
  vi.setSystemTime(clock);
  fake = new FakeSpeech([voice('Yuna', 'ko-KR', { default: true }), voice('Google 한국어', 'ko_KR')]);
  fake.install();
  stopAiAssistant.mockReset();
  resetSpeechNoticeForTest();
  useAiChatStore.setState({ entries: [question, answer], pendingId: null, live: null });
  useSteelmanWakeStore.setState({
    employeeId: null,
    enabled: true,
    voiceApproval: false,
    company: { wake: true, voiceApproval: false },
    speak: true,
    voiceUri: null,
    speechRate: 1,
    called: null,
    notice: null,
    activity: null,
    approval: null,
    screenConfirm: null,
    panelRequest: null,
    voiceQuestionId: null,
    commandPrefix: null,
  });
  setSteelmanSpeaker(speakVoiceReply);
  unwatch = watchSteelmanSpeech();
});

afterEach(() => {
  unwatch();
  setSteelmanSpeaker(null);
  stopSpeaking('interrupted');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('말로 물은 답 읽기', () => {
  it('답이 끝나면 마크다운·표를 뺀 글을 읽고 화면 안내로 끝낸다', () => {
    afterVoiceAnswer(answer);
    expect(fake.spoken).toHaveLength(1);
    expect(fake.spoken[0].text).toBe(`열연 코일 재고는 12.5톤이에요.\n${SPEAK_MORE_ON_SCREEN}`.replace('\n', ' '));
    expect(useSteelmanSpeechStore.getState().speaking).toEqual({ key: 'e1', source: 'voice' });
  });

  it('읽는 동안 듣기(마이크)를 쉬고, 다 읽은 뒤 잠깐 더 쉰 다음 다시 듣는다', () => {
    expect(wakeMuted()).toBe(false);
    afterVoiceAnswer(answer);
    expect(wakeMuted()).toBe(true);
    fake.finishAll();
    expect(wakeMuted()).toBe(true);
    vi.advanceTimersByTime(SPEECH_TAIL_MS + 1);
    expect(wakeMuted()).toBe(false);
  });

  it('이어 말하기 10초는 읽기가 끝난 뒤부터 센다', () => {
    afterVoiceAnswer(answer);
    // 읽는 동안에는 기다리는 시간이 시작되지 않는다
    fake.startCurrent();
    vi.advanceTimersByTime(15_000);
    expect(wake().called).toBeNull();
    fake.finishAll();
    const endedAt = Date.now();
    expect(wake().called).toMatchObject({ followUp: true });
    expect(wake().called?.until).toBe(endedAt + CONVERSATION_FOLLOW_UP_MS);
  });

  it('읽어 주기를 끄면 읽지 않고 이어 말하기를 바로 센다', () => {
    useSteelmanWakeStore.setState({ speak: false });
    afterVoiceAnswer(answer);
    expect(fake.spoken).toHaveLength(0);
    expect(wakeMuted()).toBe(false);
    expect(wake().called?.until).toBe(Date.now() + CONVERSATION_FOLLOW_UP_MS);
  });

  it('실패한 질문(답이 아닌 줄)이나 빈 답은 읽지 않는다', () => {
    afterVoiceAnswer({ id: 'f1', role: 'failure', content: '답을 받지 못했어요', question: '재고' });
    afterVoiceAnswer({ id: 'e2', role: 'assistant', content: '  ', sources: [] });
    expect(fake.spoken).toHaveLength(0);
    expect(wake().called).not.toBeNull();
  });

  it('한국어 목소리가 없으면 읽기를 건너뛰고 한 번만 안내한다', () => {
    fake.voices = [voice('Samantha', 'en-US')];
    afterVoiceAnswer(answer);
    expect(fake.spoken).toHaveLength(0);
    expect(wake().notice?.text).toContain('한국어 목소리가 없어');
    expect(wake().called?.until).toBe(Date.now() + CONVERSATION_FOLLOW_UP_MS);
    const first = wake().notice?.id;
    afterVoiceAnswer(answer);
    expect(wake().notice?.id).toBe(first);
  });

  it('브라우저가 소리를 막으면 안내하고 이어 말하기는 센다', () => {
    afterVoiceAnswer(answer);
    fake.failCurrent();
    expect(wake().notice?.text).toContain('브라우저가 소리를 막았어요');
    expect(wakeMuted()).toBe(true);
    expect(wake().called).not.toBeNull();
  });
});

describe('읽는 중 멈추기', () => {
  it('[멈춤]을 누르면 바로 멈추고, 멈춘 때부터 이어 말하기를 센다', () => {
    afterVoiceAnswer(answer);
    expect(toggleReadAloud('e1', answer.role === 'assistant' ? answer.content : '')).toBe('stopped');
    expect(fake.cancelCount).toBe(1);
    expect(useSteelmanSpeechStore.getState().speaking).toBeNull();
    expect(wake().called?.until).toBe(Date.now() + CONVERSATION_FOLLOW_UP_MS);
  });

  it('"철강맨, 멈춰"는 읽기를 멈춘다 (답을 멈추는 명령은 부르지 않는다)', () => {
    afterVoiceAnswer(answer);
    handleText('철강맨, 멈춰', false);
    expect(fake.cancelCount).toBe(1);
    expect(stopAiAssistant).not.toHaveBeenCalled();
    expect(wake().notice?.text).toBe('읽기를 멈췄어요');
  });

  it('읽는 중 새 질문이 시작되면 읽기를 끊고 이어 말하기는 열지 않는다', () => {
    afterVoiceAnswer(answer);
    useAiChatStore.getState().addQuestion('q2', '다른 질문');
    expect(fake.cancelCount).toBe(1);
    expect(useSteelmanSpeechStore.getState().speaking).toBeNull();
    expect(wake().called).toBeNull();
  });

  it('읽던 답이 사라지면(새 대화) 끊는다', () => {
    afterVoiceAnswer(answer);
    useAiChatStore.getState().clear();
    expect(fake.cancelCount).toBe(1);
    expect(wake().called).toBeNull();
  });

  it('부르기를 끄면 부르기로 읽던 것을 끊는다', () => {
    afterVoiceAnswer(answer);
    useSteelmanWakeStore.setState({ enabled: false });
    expect(fake.cancelCount).toBe(1);
    expect(wake().called).toBeNull();
  });

  it('부르기를 꺼도 읽기 단추로 읽던 것은 계속 읽는다', () => {
    toggleReadAloud('e1', '읽는 글이에요.');
    useSteelmanWakeStore.setState({ enabled: false });
    expect(fake.cancelCount).toBe(0);
    expect(useSteelmanSpeechStore.getState().speaking?.key).toBe('e1');
  });
});

describe('답마다 있는 읽기 단추', () => {
  it('눌러서 읽고, 읽는 중 다시 누르면 멈춘다. 읽어 주기 설정이 꺼져 있어도 읽는다', () => {
    useSteelmanWakeStore.setState({ speak: false });
    expect(toggleReadAloud('e1', '재고는 12톤이에요.')).toBe('started');
    expect(useSteelmanSpeechStore.getState().speaking).toEqual({ key: 'e1', source: 'button' });
    expect(wakeMuted()).toBe(true);
    expect(toggleReadAloud('e1', '재고는 12톤이에요.')).toBe('stopped');
    // 단추로 읽은 것은 이어 말하기를 열지 않는다
    expect(wake().called).toBeNull();
  });

  it('다 읽으면 이어 말하기 없이 마이크만 돌아온다', () => {
    toggleReadAloud('e1', '재고는 12톤이에요.');
    fake.finishAll();
    expect(wake().called).toBeNull();
    vi.advanceTimersByTime(SPEECH_TAIL_MS + 1);
    expect(wakeMuted()).toBe(false);
  });

  it('다른 답의 단추를 누르면 읽던 답은 끊기고 새 답을 읽는다', () => {
    useAiChatStore.setState({ entries: [question, answer, { id: 'e2', role: 'assistant', content: '둘째 답이에요.', sources: [] }] });
    toggleReadAloud('e1', '첫째 답이에요.');
    toggleReadAloud('e2', '둘째 답이에요.');
    expect(useSteelmanSpeechStore.getState().speaking?.key).toBe('e2');
    expect(fake.spoken.map((item) => item.text)).toEqual(['첫째 답이에요.', '둘째 답이에요.']);
  });

  it('한국어 목소리가 없으면 읽지 못했다고 돌려준다', () => {
    fake.voices = [];
    expect(toggleReadAloud('e1', '글이에요.')).toBe('unavailable');
    expect(wakeMuted()).toBe(false);
  });
});

describe('개인 설정이 읽기에 먹는다', () => {
  const storageOf = () => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) } });
    return data;
  };

  it('고른 목소리와 빠르기로 읽는다', () => {
    wake().setSpeechVoice('Google 한국어');
    wake().setSpeechRate(1.5);
    afterVoiceAnswer(answer);
    expect(fake.spoken[0].voice?.name).toBe('Google 한국어');
    expect(fake.spoken[0].rate).toBe(1.5);
  });

  it('범위를 벗어난 빠르기는 맞춰 저장하고, 이 브라우저에서 모르는 목소리는 기본 한국어 목소리로 읽는다', () => {
    wake().setSpeechRate(9);
    expect(wake().speechRate).toBe(2);
    wake().setSpeechVoice('다른 기기의 목소리');
    toggleReadAloud('e1', '글이에요.');
    expect(fake.spoken[0].voice?.name).toBe('Yuna');
  });

  it('켜기·목소리·빠르기를 사원별 저장소에 함께 저장한다 (부르기 켜기와 같은 방식)', () => {
    const data = storageOf();
    useSteelmanWakeStore.setState({ employeeId: 7 });
    wake().setSpeak(false);
    wake().setSpeechVoice('Yuna');
    wake().setSpeechRate(1.25);
    expect(JSON.parse(data.get(steelmanWakeKeyOf(7)) ?? '{}')).toEqual({ wake: true, voiceApproval: false, sensitivity: 'normal', speak: false, voiceUri: 'Yuna', speechRate: 1.25 });
    // 다른 설정을 바꿔도 읽기 설정이 지워지지 않는다
    wake().setSensitivity('high');
    expect(JSON.parse(data.get(steelmanWakeKeyOf(7)) ?? '{}')).toMatchObject({ sensitivity: 'high', speak: false, voiceUri: 'Yuna', speechRate: 1.25 });
    // 다시 읽으면(다른 사원이 들어왔다 돌아와도) 저장한 값이 돌아온다
    wake().load(7);
    expect(wake()).toMatchObject({ speak: false, voiceUri: 'Yuna', speechRate: 1.25, sensitivity: 'high' });
    wake().load(8);
    expect(wake()).toMatchObject({ speak: true, voiceUri: null, speechRate: 1 });
  });

  it('[들어 보기]는 고른 목소리로 짧은 글을 읽고 다시 누르면 멈춘다 (읽던 답이 없어도 끊기지 않는다)', () => {
    wake().setSpeechVoice('Google 한국어');
    expect(toggleSpeechSample()).toBe('started');
    expect(fake.spoken[0].voice?.name).toBe('Google 한국어');
    expect(fake.cancelCount).toBe(0);
    expect(toggleSpeechSample()).toBe('stopped');
    expect(fake.cancelCount).toBe(1);
  });
});
