'use client';

// 브라우저 마이크 녹음: 시작/끝 두 단계. 끝내면 File을 위로 올려 보낸다. 원본 음성은 서버에도 저장되지 않는다 (BP-VOC-01).
import { useEffect, useRef, useState } from 'react';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { fmtBytes } from '@/lib/format';
import { createRecordStartGuard, fmtClock, microphoneErrorMessage, pickRecorderMimeType, recordingFileName } from '@/lib/meetingAudio';

type Phase = 'idle' | 'requesting' | 'recording' | 'done';

export function AudioRecorder({ disabled, file, onChange }: { disabled: boolean; file: File | null; onChange: (file: File | null) => void }) {
  const [phase, setPhase] = useState<Phase>(file ? 'done' : 'idle');
  const [elapsed, setElapsed] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  // 시작을 한 번만 받고, 화면을 떠난 뒤 늦게 허락된 마이크는 바로 끈다 (StrictMode에서 effect가 다시 돌아도 새 표를 쓴다)
  const guardRef = useRef(createRecordStartGuard());

  const release = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  // 화면을 떠나면 마이크를 반드시 끈다. 권한 창이 떠 있는 사이 떠난 경우는 start가 허락된 마이크를 바로 끈다
  useEffect(() => {
    guardRef.current = createRecordStartGuard();
    const guard = guardRef.current;
    return () => {
      guard.cancel();
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
      }
      release();
    };
  }, []);

  const start = async () => {
    const guard = guardRef.current;
    const token = guard.begin();
    if (token === null) return;
    setProblem(null);
    onChange(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      guard.end();
      setProblem(microphoneErrorMessage(null, window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'));
      return;
    }
    setPhase('requesting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      guard.end();
      if (!guard.isCurrent(token)) return;
      setPhase('idle');
      setProblem(microphoneErrorMessage(error, true));
      return;
    }
    if (!guard.isCurrent(token)) {
      // 권한 창이 떠 있는 사이 화면을 떠났다: 늦게 허락된 마이크를 켜 두지 않는다
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    release();
    streamRef.current = stream;
    try {
      const mimeType = pickRecorderMimeType((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || 'audio/webm';
        release();
        guard.end();
        const blob = new Blob(chunks, { type });
        onChange(new File([blob], recordingFileName(type), { type }));
        setPhase('done');
      };
      recorderRef.current = recorder;
      recorder.start();
    } catch (error) {
      // 녹음기를 만들거나 시작하지 못해도 마이크를 열어 둔 채 '허용을 기다리는 중'에 갇히지 않게 되돌린다
      recorderRef.current = null;
      release();
      guard.end();
      setPhase('idle');
      setProblem(microphoneErrorMessage(error, true));
      return;
    }
    startedAtRef.current = Date.now();
    setElapsed(0);
    setPhase('recording');
    timerRef.current = setInterval(() => setElapsed((Date.now() - startedAtRef.current) / 1000), 250);
  };

  const stop = () => {
    const recorder = recorderRef.current;
    setElapsed((Date.now() - startedAtRef.current) / 1000);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };

  const reset = () => {
    onChange(null);
    setElapsed(0);
    setPhase('idle');
  };

  return (
    <div className="flex flex-col gap-2.5">
      {problem ? <Banner tone="danger">{problem}</Banner> : null}
      <div className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-3.5 py-3">
        <span className="font-mono text-lg tabular-nums" aria-live="off">
          {fmtClock(elapsed)}
        </span>
        {phase === 'idle' || phase === 'requesting' ? (
          <Button icon="mic" onClick={start} disabled={disabled || phase === 'requesting'}>
            {phase === 'requesting' ? '마이크 허용을 기다리는 중…' : '녹음 시작'}
          </Button>
        ) : null}
        {phase === 'recording' ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-sm text-danger">
              <span className="size-2 animate-pulse rounded-full bg-danger" aria-hidden="true" />
              녹음 중…
            </span>
            <Button variant="danger" onClick={stop}>
              녹음 끝내기
            </Button>
          </>
        ) : null}
        {phase === 'done' && file ? (
          <>
            <span className="text-sm text-ink-2">
              녹음 길이 {fmtClock(elapsed)} · {fmtBytes(file.size)}
            </span>
            <Button size="sm" onClick={reset} disabled={disabled}>
              다시 녹음
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
