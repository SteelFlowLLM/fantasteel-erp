'use client';

// 철강맨 부르기 (이슈 #457, 문서에 없는 기능): "철강맨~"으로 부르면 듣고 말한 일을 한다. 1단계는 답을 글로 보인다.
// 소리는 우리 음성 서버로만 간다: 브라우저가 소리 크기로 말 조각만 잘라(lib/voiceClip.ts) ERP 서버(stt/wake-clip)로 보내고,
// 받아쓴 글에서 부르는 말을 찾는다(lib/steelmanWake.ts). 부르는 말이 없는 글은 바로 버린다.
// 켜 있는 동안 화면 위쪽 띠에 '듣는 중'이 늘 보이고 거기서 바로 끈다. 탭이 숨겨지면 마이크를 닫고, 돌아오면 다시 연다.
import type { AiActionCard } from '@fantasteel/shared';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { fields, useDirectoryNames } from '@/features/meetings/components/MeetingAnalysisPanel';
import { SteelmanAiStatus } from '@/features/shell/SteelmanAiStatus';
import { useMe } from '@/hooks/useMe';
import { useAiCapabilities } from '@/hooks/useAiAssistant';
import { CARD_KIND_LABEL, isWorkCard } from '@/lib/aiActionCard';
import { microphoneErrorMessage } from '@/lib/meetingAudio';
import { speakSteelmanReply } from '@/lib/steelmanVoice';
import { executeApproved, setWakeAudioContext, transcribe, turnOnScreenControl, wakeMuted } from '@/lib/steelmanWakeActions';
import { ClipUploadQueue, clipToWav, VoiceSegmenter } from '@/lib/voiceClip';
import { useAiChatStore } from '@/stores/useAiChatStore';
import { useSteelmanWakeStore } from '@/stores/useSteelmanWakeStore';

/** 안내를 띠에 보이는 시간 */
const NOTICE_MS = 4_000;
/** 소리 처리 묶음 크기 (48kHz면 약 43ms) */
const FRAME_SIZE = 2048;

const store = () => useSteelmanWakeStore.getState();

/**
 * 셸에 늘 붙어 있는 듣기 담당 + 위쪽 띠 + 말로 승인 창. 꺼져 있으면 아무것도 그리지 않고 마이크도 열지 않는다
 */
export function SteelmanWake() {
  const me = useMe();
  const loadedFor = useSteelmanWakeStore((state) => state.employeeId);
  const enabled = useSteelmanWakeStore((state) => state.enabled);
  const capabilities = useAiCapabilities();
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
  const active = enabled && loadedFor === me.employeeId;

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
    const uploads = new ClipUploadQueue<Blob>((wav) => transcribe(wav, () => cancelled, () => screenControlRef.current), () => cancelled);
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
      context = new AudioContext();
      setWakeAudioContext(context);
      const source = context.createMediaStreamSource(stream);
      // AudioWorklet은 모듈 파일이 따로 필요해서, 짧은 말 조각에는 충분한 ScriptProcessor를 쓴다
      processor = context.createScriptProcessor(FRAME_SIZE, 1, 1);
      const segmenter = new VoiceSegmenter({ sampleRate: context.sampleRate });
      const rate = context.sampleRate;
      processor.onaudioprocess = (event) => {
        if (wakeMuted()) {
          segmenter.reset();
          return;
        }
        const clip = segmenter.feed(new Float32Array(event.inputBuffer.getChannelData(0)));
        if (store().hearing !== segmenter.speaking) store().setHearing(segmenter.speaking);
        if (!clip) return;
        uploads.push(clipToWav(clip, rate));
      };
      source.connect(processor);
      processor.connect(context.destination);
      store().setStatus('listening', null);
    })();
    return () => {
      cancelled = true;
      if (processor) processor.onaudioprocess = null;
      processor?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
      setWakeAudioContext(null);
      store().setHearing(false);
    };
  }, [active, visible]);

  useSpeakVoiceAnswers();
  useExpireTimers();

  if (!active) return null;
  return (
    <>
      <SteelmanWakeBar />
      <VoiceApprovalDialog />
      <ScreenControlConfirmDialog />
    </>
  );
}

/** "철강맨"만 부른 뒤 기다리기·말로 승인·안내가 제때 사라지게 한다 */
function useExpireTimers(): void {
  const called = useSteelmanWakeStore((state) => state.called);
  const approval = useSteelmanWakeStore((state) => state.approval);
  const notice = useSteelmanWakeStore((state) => state.notice);
  const screenConfirm = useSteelmanWakeStore((state) => state.screenConfirm);
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
    const timer = window.setTimeout(() => {
      if (store().called === called) store().setCalled(null);
    }, Math.max(0, called.until - Date.now()));
    return () => window.clearTimeout(timer);
  }, [called]);
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

/** 말로 물은 질문의 답이 끝나면 읽어 줄 자리로 넘긴다 (1단계는 글로만 보인다) */
function useSpeakVoiceAnswers(): void {
  useEffect(
    () =>
      useAiChatStore.subscribe((state, previous) => {
        const voiceId = store().voiceQuestionId;
        if (!voiceId || previous.pendingId !== voiceId || state.pendingId === voiceId) return;
        store().setVoiceQuestionId(null);
        const last = state.entries.at(-1);
        if (last?.role === 'assistant') speakSteelmanReply(last.content);
      }),
    [],
  );
}

function SteelmanWakeBar() {
  const status = useSteelmanWakeStore((state) => state.status);
  const hearing = useSteelmanWakeStore((state) => state.hearing);
  const problem = useSteelmanWakeStore((state) => state.problem);
  const called = useSteelmanWakeStore((state) => state.called);
  const notice = useSteelmanWakeStore((state) => state.notice);
  const voiceApproval = useSteelmanWakeStore((state) => state.voiceApproval);
  const label = status === 'starting' ? '마이크를 여는 중…' : status === 'paused' ? '탭이 숨겨져 잠깐 쉬어요' : status === 'error' ? '듣지 못하고 있어요' : hearing ? '듣는 중 · 말소리를 잡았어요' : '듣는 중 · "철강맨, 재고 알려줘"처럼 불러 주세요';
  return (
    <div data-ai-skip="" role="status" aria-live="polite" className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-steelman bg-steelman-soft px-4 py-1.5 text-sm text-steelman-ink">
      <span className={`inline-flex items-center gap-1.5 font-semibold ${hearing ? 'animate-pulse' : ''}`}>
        <Icon name="mic" size="sm" />
        철강맨 부르기
      </span>
      <span className="text-cap">{label}</span>
      {called ? (
        <span className="inline-flex items-center gap-1.5">
          <SteelmanAiStatus size="sm" status="listening" seedKey={called.reply} className="h-7 w-8" />
          <b className="rounded-[10px] border-2 border-steelman bg-surface px-2 py-0.5 text-sm">{called.reply}</b>
        </span>
      ) : null}
      {problem ? <span className="text-cap font-medium text-danger">{problem}</span> : null}
      {notice ? <span className="text-cap font-medium">{notice.text}</span> : null}
      <label className="ml-auto inline-flex items-center gap-1 text-cap" title="켜면 '철강맨, 이거 실행해줘' → '실행'으로 업무·일정·구매요청 초안 카드를 실행해요. 이 브라우저에만 저장돼요">
        <input type="checkbox" checked={voiceApproval} onChange={(event) => store().setVoiceApproval(event.target.checked)} />
        말로 승인 허용
      </label>
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
  const voiceApproval = useSteelmanWakeStore((state) => state.voiceApproval);
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
