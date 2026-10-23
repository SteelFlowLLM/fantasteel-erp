'use client';

// 철강맨 부르기 (이슈 #494)의 원(오브): 시리처럼 말소리 크기에 따라 커지고 물결친다. 장식이라 aria-hidden이고, 상태는 띠 글자(role=status)가 알린다.
// 소리 크기는 스토어가 아니라 lib/wakeOrb.ts의 wakeLiveLevel을 requestAnimationFrame으로 읽어 CSS 변수만 바꾼다 (다시 그리지 않음).
// prefers-reduced-motion이면 움직이지 않고 색·크기만 상태에 맞춘다. 모양은 styles/wake-orb.css.
import { useEffect, useRef } from 'react';
import { orbTargetScale, smoothOrbScale, wakeLiveLevel, wakeOrbModeOf, type WakeOrbMode } from '@/lib/wakeOrb';
import { wakeLevelPercent } from '@/lib/steelmanWakeDisplay';
import { useSteelmanSpeechStore } from '@/lib/steelmanSpeech';
import { useAiChatStore } from '@/stores/useAiChatStore';
import { useSteelmanWakeStore } from '@/stores/useSteelmanWakeStore';

const reducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** 지금 원의 모양 */
export function useWakeOrbMode(): WakeOrbMode {
  const status = useSteelmanWakeStore((state) => state.status);
  const audioBlocked = useSteelmanWakeStore((state) => state.audioBlocked);
  const hearing = useSteelmanWakeStore((state) => state.hearing);
  const transcribing = useSteelmanWakeStore((state) => state.transcribing);
  const called = useSteelmanWakeStore((state) => state.called !== null);
  const voiceQuestionId = useSteelmanWakeStore((state) => state.voiceQuestionId);
  const waitingAnswer = useAiChatStore((state) => voiceQuestionId !== null && state.pendingId === voiceQuestionId);
  // 철강맨이 읽어 주는 동안(이슈 #507)도 답하는 모양: 마이크는 쉬고 있다
  const reading = useSteelmanSpeechStore((state) => state.speaking !== null);
  return wakeOrbModeOf({ status, audioBlocked, hearing, transcribing, called, answering: waitingAnswer || reading });
}

/** 화면 그리기마다 목소리 크기를 읽어 원 크기(--orb-scale)를 바꾼다. 듣는 중·말소리 잡음일 때만 */
function useOrbScale(ref: React.RefObject<HTMLElement | null>, mode: WakeOrbMode): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const follows = mode === 'idle' || mode === 'speaking' || mode === 'called';
    if (!follows || reducedMotion()) {
      element.style.setProperty('--orb-scale', mode === 'speaking' || mode === 'called' ? '1.2' : '1');
      return;
    }
    let scale = 1;
    let frame = requestAnimationFrame(function tick() {
      scale = smoothOrbScale(scale, orbTargetScale(wakeLiveLevel.rms, wakeLiveLevel.threshold));
      element.style.setProperty('--orb-scale', scale.toFixed(3));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [ref, mode]);
}

export function WakeOrb({ size }: { size: 'sm' | 'lg' }) {
  const mode = useWakeOrbMode();
  const ref = useRef<HTMLSpanElement>(null);
  useOrbScale(ref, mode);
  return (
    <span ref={ref} aria-hidden="true" className={`wake-orb wake-orb--${size}`} data-orb-mode={mode}>
      <span className="wake-orb__wave" />
      <span className="wake-orb__core" />
      <span className="wake-orb__ring" />
    </span>
  );
}

/** "철강맨"만 불렀을 때 화면 아래 가운데에 크게 뜨는 원과 남은 시간 테. 패널이 닫혀 있어도 보인다 */
export function WakeCalledOrb() {
  const called = useSteelmanWakeStore((state) => state.called);
  if (!called) return null;
  const leftMs = Math.max(0, called.until - Date.now());
  return (
    <div data-ai-skip="" aria-hidden="true" className="pointer-events-none fixed bottom-10 left-1/2 z-[55] flex -translate-x-1/2 flex-col items-center gap-2">
      <span className="relative inline-flex">
        <WakeOrb size="lg" />
        {/* 남은 시간 테: 기다리는 시간 동안 줄어든다. 새로 부르면 처음부터 (key) */}
        <svg key={called.until} className="wake-orb-countdown" viewBox="0 0 120 120" style={{ animationDuration: `${leftMs}ms` }}>
          <circle cx="60" cy="60" r="56" pathLength={100} />
        </svg>
      </span>
      <b className="rounded-[10px] border-2 border-steelman bg-surface px-3 py-1 text-base text-steelman-ink shadow-pop">{called.reply} 말씀하세요</b>
    </div>
  );
}

/** 소리 크기 막대 (장식). 가운데 금이 말 시작 기준이고 넘으면 진하게 칠한다. 민감도를 맞출 때 본다 */
export function WakeLevelMeter() {
  const fill = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = fill.current;
    if (!element) return;
    let frame = requestAnimationFrame(function tick() {
      const percent = wakeLevelPercent(wakeLiveLevel.rms, wakeLiveLevel.threshold);
      element.style.width = `${percent}%`;
      element.dataset.over = percent >= 50 ? 'true' : 'false';
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <span aria-hidden="true" className="wake-meter" title="가운데 금을 넘으면 말소리로 잡아요. 넘지 않으면 민감도를 높여 보세요">
      <span ref={fill} className="wake-meter__fill" />
      <span className="wake-meter__mark" />
    </span>
  );
}
