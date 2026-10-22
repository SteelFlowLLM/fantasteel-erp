'use client';

// 철강맨 부르기 (이슈 #457, 문서에 없는 기능): "철강맨~"으로 부르면 듣고 말한 일을 한다. 답은 글로 보이고, 읽어 주기(이슈 #507)가 켜져 있으면 브라우저 음성으로도 읽는다.
// 소리는 우리 음성 서버로만 간다: 브라우저가 소리 크기로 말 조각만 잘라(lib/voiceClip.ts) ERP 서버(stt/wake-clip)로 보내고,
// 받아쓴 글에서 부르는 말을 찾는다(lib/steelmanWake.ts). 부르는 말이 없는 글은 바로 버린다.
// 켜 있는 동안 화면 위쪽 띠에 '듣는 중'이 늘 보이고 거기서 바로 끈다. 탭이 숨겨지면 마이크를 닫고, 돌아오면 다시 연다.
// 띠는 지금 단계(소리 크기·받아쓰는 중·들은 말·물어보는 중·답하는 중·읽어 주는 중)를 보인다 (이슈 #494). 받아쓴 글은 이 화면 메모리에만 몇 초 둔다.
// 읽는 동안은 마이크가 쉬고(lib/steelmanWakeActions.ts의 wakeMuted) 다 읽으면 다시 듣는다. 이어 말하기 시간은 다 읽은 뒤부터 센다.
import type { AiActionCard } from '@fantasteel/shared';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { fields, useDirectoryNames } from '@/features/meetings/components/MeetingAnalysisPanel';
import { SteelmanAiStatus } from '@/features/shell/SteelmanAiStatus';
import { useMe } from '@/hooks/useMe';
import { useAiCapabilities } from '@/hooks/useAiAssistant';
import { CARD_KIND_LABEL, isWorkCard } from '@/lib/aiActionCard';
import { microphoneErrorMessage } from '@/lib/meetingAudio';
import { setSteelmanSpeaker } from '@/lib/steelmanVoice';
import { koreanVoices, stopSpeaking, useSteelmanSpeechStore } from '@/lib/steelmanSpeech';
import { COMMAND_QUIET_MS } from '@/lib/steelmanWake';
import { afterVoiceAnswer, executeApproved, flushCommandPrefix, setWakeAudioContext, speakVoiceReply, transcribe, restMicIfMuted, transcribePartial, turnOnScreenControl, watchSteelmanSpeech, type HeardClip } from '@/lib/steelmanWakeActions';
import { WAKE_SENSITIVITIES, WAKE_SENSITIVITY_LABEL, WAKE_START_RMS, wakeBarLine, type WakeSensitivity } from '@/lib/steelmanWakeDisplay';
import { setWakeLiveLevel } from '@/lib/wakeOrb';
import { WakeCalledOrb, WakeLevelMeter, WakeOrb } from '@/features/shell/WakeOrb';
import { ClipUploadQueue, clipToWav, VoiceSegmenter } from '@/lib/voiceClip';
import { keepAudioRunning } from '@/lib/wakeAudioUnlock';
import { useAiChatStore } from '@/stores/useAiChatStore';
import { useShellStore } from '@/stores/useShellStore';
import { SteelmanSpeakMenu } from '@/features/shell/SteelmanSpeakMenu';
import { useSteelmanWakeStore, voiceApprovalAllowed } from '@/stores/useSteelmanWakeStore';

/** 안내를 띠에 보이는 시간 */
const NOTICE_MS = 4_000;
/** 소리 처리 묶음 크기 (48kHz면 약 43ms) */
const FRAME_SIZE = 2048;
/**
 * 명령을 말하는 동안 지금까지의 덩어리를 다시 받아써 중간 글을 보이는 간격 (이슈 #494, 가정값).
 * 음성 서버가 2~12초 조각을 길이와 거의 상관없이 0.3초 안팎에 받아써(2026-10-22 측정) 30초 말에도 15번이면 된다
 */
const PARTIAL_INTERVAL_MS = 2_000;

const store = () => useSteelmanWakeStore.getState();

/**
 * 셸에 늘 붙어 있는 듣기 담당 + 위쪽 띠 + 말로 승인 창. 꺼져 있으면 아무것도 그리지 않고 마이크도 열지 않는다
 */
export function SteelmanWake() {
  const me = useMe();
  const loadedFor = useSteelmanWakeStore((state) => state.employeeId);
  const enabled = useSteelmanWakeStore((state) => state.enabled);
  const companyWake = useSteelmanWakeStore((state) => state.company.wake);
  const capabilities = useAiCapabilities();
  const companyFromServer = capabilities.data?.steelmanWake;
  useEffect(() => {
    if (companyFromServer) store().setCompany({ wake: companyFromServer.available, voiceApproval: companyFromServer.voiceApproval });
  }, [companyFromServer]);
  const screenControlAvailable = capabilities.data?.screenControl?.available === true;
  const screenControlRef = useRef(screenControlAvailable);
  screenControlRef.current = screenControlAvailable;
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (loadedFor !== me.employeeId) store().load(me.employeeId);
  }, [loadedFor, me.employeeId]);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  // 이 사원의 설정을 읽기 전에는 앞 사원의 켜기 설정으로 마이크를 열지 않는다
  const active = enabled && companyWake && loadedFor === me.employeeId;

  // 켜 있고 탭이 보일 때만 마이크를 연다. 끄거나 숨기면 마이크 표시등까지 꺼지게 트랙을 닫는다
  useEffect(() => {
    if (!active) return;
    if (!visible) {
      store().setStatus('paused');
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let processor: ScriptProcessorNode | null = null;
    // 멈춘 AudioContext 깨우기를 그만두는 함수 (마이크를 연 뒤 정해진다)
    let stopUnlock: (() => void) | null = null;
    const uploads = new ClipUploadQueue<{ wav: Blob; clip: HeardClip }>((item) => transcribe(item.wav, () => cancelled, () => screenControlRef.current, item.clip), () => cancelled);
    store().setStatus('starting');
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      } catch (error) {
        if (!cancelled) store().setStatus('error', microphoneErrorMessage(error, window.isSecureContext));
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const audio = new AudioContext();
      context = audio;
      setWakeAudioContext(audio);
      const source = audio.createMediaStreamSource(stream);
      // AudioWorklet은 모듈 파일이 따로 필요해서, 짧은 말 조각에는 충분한 ScriptProcessor를 쓴다
      processor = audio.createScriptProcessor(FRAME_SIZE, 1, 1);
      const segmenter = new VoiceSegmenter({ sampleRate: audio.sampleRate, minStartRms: WAKE_START_RMS[store().sensitivity] });
      const rate = audio.sampleRate;
      let partialAt = 0;
      let quietSince: number | null = null;
      processor.onaudioprocess = (event) => {
        // 띠링이나 철강맨이 읽는 소리 동안은 듣지 않는다 (이슈 #507)
        if (restMicIfMuted(segmenter)) return;
        const wake = store();
        // 민감도는 듣는 중에도 바꿀 수 있다 (마이크를 다시 열지 않는다)
        segmenter.minStartRms = WAKE_START_RMS[wake.sensitivity];
        // "철강맨"을 들었거나(대답·이어 말하기) 잘린 명령을 이어 듣는 중이면 말이 끝날 때까지 한 덩어리로 듣는다 (이슈 #494)
        segmenter.mode = wake.called || wake.commandPrefix ? 'command' : 'wake';
        const clip = segmenter.feed(new Float32Array(event.inputBuffer.getChannelData(0)));
        if (wake.hearing !== segmenter.speaking) wake.setHearing(segmenter.speaking);
        // 원·막대는 이 값을 화면 그리기 때마다 읽는다 (스토어를 바꾸지 않아 다시 그리지 않는다)
        setWakeLiveLevel(segmenter.lastRms, segmenter.startThreshold);
        const now = performance.now();
        // 명령을 말하는 동안 2초마다 지금까지의 덩어리를 받아써 띠에 보인다 (1초보다 짧으면 보내지 않는다)
        if (segmenter.speaking && segmenter.mode === 'command') {
          if (now - partialAt >= PARTIAL_INTERVAL_MS) {
            partialAt = now;
            const soFar = segmenter.snapshot();
            if (soFar && soFar.length >= rate) void transcribePartial(clipToWav(soFar, rate), () => cancelled);
          }
        } else partialAt = now;
        // 잘린 명령 뒤 말이 더 없으면(조용하고 받아쓸 것도 없음) 들은 데까지 묻는다
        if (wake.commandPrefix && !segmenter.speaking && !wake.transcribing && uploads.size === 0) {
          quietSince ??= now;
          if (now - quietSince >= COMMAND_QUIET_MS) {
            quietSince = null;
            flushCommandPrefix(screenControlRef.current);
          }
        } else quietSince = null;
        if (!clip) return;
        uploads.push({ wav: clipToWav(clip, rate), clip: { ...segmenter.lastClip } });
      };
      source.connect(processor);
      processor.connect(audio.destination);
      store().setStatus('listening', null);
      // 사용자가 누르지 않은 때 만든 AudioContext는 브라우저가 멈춰 두어 '듣는 중'인데 아무것도 듣지 못한다.
      // 깨워 보고 안 되면 띠에서 화면을 한 번 눌러 달라고 한다 (이슈 #494, lib/wakeAudioUnlock.ts)
      stopUnlock = keepAudioRunning(audio, (blocked) => store().setAudioBlocked(blocked), window);
    })();
    return () => {
      cancelled = true;
      if (processor) processor.onaudioprocess = null;
      processor?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      stopUnlock?.();
      void context?.close();
      setWakeAudioContext(null);
      store().setHearing(false);
      store().setAudioBlocked(false);
      store().setTranscribing(false);
      setWakeLiveLevel(0, 0);
    };
  }, [active, visible]);

  useSpeakVoiceAnswers();
  useExpireTimers(screenControlRef);

  if (!active) return null;
  return (
    <>
      <SteelmanWakeBar />
      <WakeCalledOrb />
      <VoiceApprovalDialog />
      <ScreenControlConfirmDialog />
    </>
  );
}

/** "철강맨"만 부른 뒤 기다리기·말로 승인·안내가 제때 사라지게 한다 */
function useExpireTimers(screenControlRef: { readonly current: boolean }): void {
  const called = useSteelmanWakeStore((state) => state.called);
  const commandPrefix = useSteelmanWakeStore((state) => state.commandPrefix);
  const approval = useSteelmanWakeStore((state) => state.approval);
  const notice = useSteelmanWakeStore((state) => state.notice);
  const screenConfirm = useSteelmanWakeStore((state) => state.screenConfirm);
  const activity = useSteelmanWakeStore((state) => state.activity);
  useEffect(() => {
    if (!activity) return;
    const timer = window.setTimeout(() => store().clearActivity(activity.id), Math.max(0, activity.until - Date.now()));
    return () => window.clearTimeout(timer);
  }, [activity]);
  useEffect(() => {
    if (!screenConfirm) return;
    const timer = window.setTimeout(() => {
      if (store().screenConfirm !== screenConfirm) return;
      store().setScreenConfirm(null);
      store().notify('10초가 지나 화면 조작을 켜지 않았어요');
    }, Math.max(0, screenConfirm.deadline - Date.now()) + 50);
    return () => window.clearTimeout(timer);
  }, [screenConfirm]);
  useEffect(() => {
    if (!called) return;
    let timer = 0;
    const expire = () => {
      if (store().called !== called) return;
      // 말하는 중이거나 받아쓰는 중이면 그 말이 끝날 때까지 기다린다 (마감 직전에 시작한 질문이 버려지지 않게)
      if (store().hearing || store().transcribing) {
        timer = window.setTimeout(expire, 300);
        return;
      }
      store().setCalled(null);
    };
    timer = window.setTimeout(expire, Math.max(0, called.until - Date.now()));
    return () => window.clearTimeout(timer);
  }, [called]);
  useEffect(() => {
    if (!commandPrefix) return;
    const timer = window.setTimeout(() => flushCommandPrefix(screenControlRef.current), Math.max(0, commandPrefix.until - Date.now()));
    return () => window.clearTimeout(timer);
  }, [commandPrefix, screenControlRef]);
  useEffect(() => {
    if (!approval) return;
    const timer = window.setTimeout(() => {
      if (store().approval !== approval) return;
      store().setApproval(null);
      store().notify('10초가 지나 실행하지 않았어요');
    }, Math.max(0, approval.deadline - Date.now()) + 50);
    return () => window.clearTimeout(timer);
  }, [approval]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => store().clearNotice(notice.id), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
}

/** 말로 물은 질문의 답이 끝나면 읽어 주고 이어 말하기를 연다 (lib/steelmanWakeActions.ts의 afterVoiceAnswer) */
function useSpeakVoiceAnswers(): void {
  useEffect(() => {
    // 1단계 목소리는 브라우저 음성. 한국어 목소리 목록은 첫 조회 때 브라우저가 채우기 시작하므로 미리 한 번 부른다
    koreanVoices();
    setSteelmanSpeaker(speakVoiceReply);
    const unwatch = watchSteelmanSpeech();
    const unsubscribe = useAiChatStore.subscribe((state, previous) => {
      const voiceId = store().voiceQuestionId;
      if (!voiceId || previous.pendingId !== voiceId || state.pendingId === voiceId) return;
      store().setVoiceQuestionId(null);
      afterVoiceAnswer(state.entries.at(-1));
    });
    return () => {
      unsubscribe();
      unwatch();
      setSteelmanSpeaker(null);
    };
  }, []);
}

/** 띠·패널 머리에 보일 지금 단계 한 줄 (이슈 #494). 남은 초가 줄어들게 기다리는 동안은 자주 다시 그린다 */
export function useWakeBarLine(): ReturnType<typeof wakeBarLine> {
  const status = useSteelmanWakeStore((state) => state.status);
  const audioBlocked = useSteelmanWakeStore((state) => state.audioBlocked);
  const hearing = useSteelmanWakeStore((state) => state.hearing);
  const transcribing = useSteelmanWakeStore((state) => state.transcribing);
  const called = useSteelmanWakeStore((state) => state.called);
  const activity = useSteelmanWakeStore((state) => state.activity);
  const voiceQuestionId = useSteelmanWakeStore((state) => state.voiceQuestionId);
  const partialText = useSteelmanWakeStore((state) => state.partialText);
  const continuing = useSteelmanWakeStore((state) => state.commandPrefix !== null);
  const answering = useAiChatStore((state) => voiceQuestionId !== null && state.pendingId === voiceQuestionId);
  const speaking = useSteelmanSpeechStore((state) => state.speaking !== null);
  const now = useTicking(called !== null);
  return wakeBarLine({ status, audioBlocked, hearing, transcribing, called, activity, answering, speaking, partialText, continuing, now });
}

/** ticking이면 0.25초마다 지금 시각을 바꾼다 */
function useTicking(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [ticking]);
  return now;
}

const LINE_TONE_CLASS = { idle: 'text-cap', busy: 'text-cap font-medium', action: 'text-cap font-bold', problem: 'text-cap font-medium text-danger' } as const;

function SteelmanWakeBar() {
  const status = useSteelmanWakeStore((state) => state.status);
  const hearing = useSteelmanWakeStore((state) => state.hearing);
  const problem = useSteelmanWakeStore((state) => state.problem);
  const called = useSteelmanWakeStore((state) => state.called);
  const notice = useSteelmanWakeStore((state) => state.notice);
  const activity = useSteelmanWakeStore((state) => state.activity);
  const sensitivity = useSteelmanWakeStore((state) => state.sensitivity);
  const voiceApproval = useSteelmanWakeStore((state) => state.voiceApproval);
  const companyVoiceApproval = useSteelmanWakeStore((state) => state.company.voiceApproval);
  const panelOpen = useShellStore((state) => state.aiPanelOpen);
  const speaking = useSteelmanSpeechStore((state) => state.speaking !== null);
  const line = useWakeBarLine();
  return (
    <div data-ai-skip="" role="status" aria-live="polite" className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-steelman bg-steelman-soft px-4 py-1.5 text-sm text-steelman-ink">
      <span className={`inline-flex items-center gap-1.5 font-semibold ${hearing ? 'animate-pulse' : ''}`}>
        <WakeOrb size="sm" />
        철강맨 부르기
      </span>
      {status === 'listening' ? <WakeLevelMeter /> : null}
      {called ? <SteelmanAiStatus size="sm" status="listening" seedKey={called.reply} className="h-7 w-8" /> : null}
      <span className={LINE_TONE_CLASS[line.tone]} data-wake-line="">
        {line.text}
      </span>
      {activity?.kind === 'answered' && !panelOpen ? (
        <Button size="sm" variant="ghost" onClick={() => useShellStore.getState().showAiPanel()}>
          답 보기
        </Button>
      ) : null}
      {speaking ? (
        <Button size="sm" icon="stop" onClick={() => stopSpeaking('stopped')}>
          읽기 멈춤
        </Button>
      ) : null}
      {problem ? <span className="text-cap font-medium text-danger">{problem}</span> : null}
      {notice ? <span className="text-cap font-medium">{notice.text}</span> : null}
      {/* 관리자가 말로 승인을 꺼 두면 칸을 보이지 않는다 (사원의 켜기 설정은 남겨 두어 회사가 다시 켜면 그대로) */}
      <label className="ml-auto inline-flex items-center gap-1 text-cap" title="높을수록 작은 목소리도 잡아요(주변 소리도 더 잡아요). 소리 크기 막대가 가운데 금을 넘어야 말로 잡아요">
        민감도
        <select
          aria-label="말 시작 민감도"
          className="rounded-sm border border-steelman bg-surface px-1 py-0.5 text-cap"
          value={sensitivity}
          onChange={(event) => store().setSensitivity(event.target.value as WakeSensitivity)}
        >
          {WAKE_SENSITIVITIES.map((value) => (
            <option key={value} value={value}>
              {WAKE_SENSITIVITY_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      {companyVoiceApproval ? (
        <label className="inline-flex items-center gap-1 text-cap" title="켜면 '철강맨, 이거 실행해줘' → '실행'으로 업무·일정·구매요청 초안 카드를 실행해요. 이 브라우저에 내 것만 저장돼요">
          <input type="checkbox" checked={voiceApproval} onChange={(event) => store().setVoiceApproval(event.target.checked)} />
          말로 승인 허용
        </label>
      ) : null}
      <SteelmanSpeakMenu appearance="bar" />
      <Button size="sm" icon="x-circle" onClick={() => store().setEnabled(false)}>
        끄기
      </Button>
    </div>
  );
}

function ApprovalSummary({ card }: { card: AiActionCard }) {
  const names = useDirectoryNames();
  if (!isWorkCard(card)) return null;
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      {card.description ? <p className="text-ink-2">{card.description}</p> : null}
      {fields(card, names)}
    </div>
  );
}

/** 말로 승인: 카드를 크게 보이고 10초 안에 "실행"을 기다린다. 손으로도 고를 수 있다 */
function VoiceApprovalDialog() {
  const approval = useSteelmanWakeStore((state) => state.approval);
  const left = useSecondsLeft(approval?.deadline ?? null);
  if (!approval) return null;
  const { card } = approval.item;
  return (
    <div data-ai-skip="" className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(18,24,32,0.46)] p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="voice-approval-title" className="flex w-full max-w-lg flex-col gap-3 rounded-lg border-2 border-steelman bg-surface p-5 shadow-pop">
        <div className="flex items-center gap-2">
          <SteelmanAiStatus status="draft_review" seedKey={card.key} />
          <div className="min-w-0">
            <p className="text-cap text-ink-3">말로 실행 · {CARD_KIND_LABEL[card.kind]}</p>
            <h2 id="voice-approval-title" className="text-lg font-bold break-words">
              {card.title}
            </h2>
          </div>
        </div>
        <ApprovalSummary card={card} />
        <p className="rounded-sm bg-steelman-soft px-3 py-2 text-base font-semibold text-steelman-ink">
          맞으면 &lsquo;실행&rsquo;이라고 말해 주세요 <span className="font-normal">({left}초)</span>
        </p>
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            onClick={() => {
              store().setApproval(null);
              store().notify('실행하지 않았어요');
            }}
          >
            취소
          </Button>
          <Button size="sm" variant="primary" onClick={() => void executeApproved(false)}>
            실행
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 1초마다 남은 초 */
function useSecondsLeft(deadline: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** "화면 조작 켜" 확인 창. 말로는 '말로 승인 허용'이 켜졌을 때만 "실행"으로 켜고, 아니면 [켜기]를 눌러야 한다 */
function ScreenControlConfirmDialog() {
  const screenConfirm = useSteelmanWakeStore((state) => state.screenConfirm);
  const voiceApproval = useSteelmanWakeStore(voiceApprovalAllowed);
  const left = useSecondsLeft(screenConfirm?.deadline ?? null);
  if (!screenConfirm) return null;
  return (
    <div data-ai-skip="" className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(18,24,32,0.46)] p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="screen-confirm-title" className="flex w-full max-w-md flex-col gap-3 rounded-lg border-2 border-steelman bg-surface p-5 shadow-pop">
        <h2 id="screen-confirm-title" className="text-lg font-bold">
          화면 조작을 켤까요?
        </h2>
        <p className="text-sm text-ink-2">켜면 철강맨AI가 이 화면을 읽고, 화면을 옮기고, 칸을 채워요. 저장·등록·확정 버튼은 누르지 않아요.</p>
        <p className="rounded-sm bg-steelman-soft px-3 py-2 text-base font-semibold text-steelman-ink">
          {voiceApproval ? <>맞으면 &lsquo;실행&rsquo;이라고 말하거나 [켜기]를 눌러 주세요</> : <>[켜기]를 눌러 주세요</>} <span className="font-normal">({left}초)</span>
        </p>
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            onClick={() => {
              store().setScreenConfirm(null);
              store().notify('화면 조작을 켜지 않았어요');
            }}
          >
            취소
          </Button>
          <Button size="sm" variant="primary" onClick={() => turnOnScreenControl(false)}>
            켜기
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 패널 머리의 [철강맨 부르기] 스위치 */
export function SteelmanWakeToggle() {
  const enabled = useSteelmanWakeStore((state) => state.enabled);
  const problem = useSteelmanWakeStore((state) => state.problem);
  // 관리자가 회사 전체로 꺼 두면 스위치를 숨긴다 (AI 연결 화면, 이슈 #457)
  const companyWake = useSteelmanWakeStore((state) => state.company.wake);
  if (!companyWake) return null;
  return (
    <IconButton
      icon="mic"
      label={enabled ? '철강맨 부르기 끄기' : '철강맨 부르기 켜기'}
      title={enabled ? (problem ?? '철강맨 부르기 켜짐 · 누르면 꺼요') : '켜면 "철강맨~"으로 불러 말로 물을 수 있어요. 소리는 우리 음성 서버로만 가요'}
      size="sm"
      aria-pressed={enabled}
      className={enabled ? 'bg-steelman-soft text-steelman-ink' : ''}
      onClick={() => store().setEnabled(!enabled)}
    />
  );
}
