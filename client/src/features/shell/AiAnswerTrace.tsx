'use client';

// 답을 만드는 과정(생각·조회·중간 글) 보기. 전역 AI 패널과 회의 질문 카드가 함께 쓴다.
// - AiLiveView: 답을 기다리는 동안 보이는 진행 상황 (생각 시간이 흐르고, 조회 중 → 완료로 바뀌고, 답 글이 자란다)
// - AiStepsDetails: 답이 끝난 뒤 답 아래에 접어 두는 '생각 과정'
import { AI_ASSISTANT_TOOL_TITLE } from '@fantasteel/shared';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { AI_BROWSER_MAX_ACTIONS, browserActionCount, browserFrameSrc, browserFramesSummary, browserToolRunningText, type AiBrowserFrame } from '@/lib/aiBrowser';
import { driveToolDoneText, driveToolRunningText } from '@/lib/aiDrive';
import { notionToolDoneText, notionToolRunningText } from '@/lib/aiNotion';
import { webToolDoneText, webToolRunningText } from '@/lib/aiWebSearch';
import { formatDuration } from '@/lib/meetingAnalysis';
import type { AiChatLive, AiTimelineStep } from '@/stores/useAiChatStore';

const SUMMARY = 'cursor-pointer select-none text-xs font-medium text-ink-2 hover:text-ink';
const PRE = 'max-h-64 overflow-auto rounded-xs bg-surface-2 px-2 py-1.5 font-mono text-cap whitespace-pre-wrap break-words text-ink-2';

/** 조회 도구의 한글 제목 (모르는 도구는 이름 그대로) */
export const toolTitleOf = (name: string): string => AI_ASSISTANT_TOOL_TITLE[name] ?? name;

/** 지난 대화 찾기 (이슈 #412) */
const historyToolRunningText = (name: string): string | null => (name === 'search_chat_history' || name === 'search_room_messages' ? ' … 찾는 중' : null);

type ThinkingStep = Extract<AiTimelineStep, { kind: 'thinking' }>;

/** 생각에 쓴 초. 끝나지 않은 생각은 now까지 */
const thinkingMs = (step: ThinkingStep, now: number): number => Math.max(0, (step.endedAt ?? now) - step.startedAt);
const wholeSeconds = (ms: number): number => Math.floor(ms / 1000);

/** 접힌 '생각 과정'의 한 줄 요약: "생각 과정 보기 · 생각 8초 · 조회 2번" */
export function aiStepsSummary(steps: readonly AiTimelineStep[]): string {
  const thinking = steps.reduce((sum, step) => (step.kind === 'thinking' ? sum + thinkingMs(step, step.startedAt) : sum), 0);
  const toolCount = steps.filter((step) => step.kind === 'tool').length;
  const parts = [
    ...(thinking > 0 ? [`생각 ${Math.max(1, Math.round(thinking / 1000))}초`] : []),
    ...(toolCount > 0 ? [`조회 ${toolCount}번`] : []),
  ];
  return ['생각 과정 보기', ...parts].join(' · ');
}

/** 생각 중인 동안 1초마다 현재 시각을 갱신한다 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function LiveThinking({ step }: { step: ThinkingStep }) {
  const active = step.endedAt === null;
  const now = useNow(active);
  const textRef = useRef<HTMLParagraphElement>(null);

  // 긴 생각 글은 높이를 제한하고 늘 끝(최신)이 보이게 한다
  useEffect(() => {
    const element = textRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [step.text]);

  return (
    // 생각 글은 길고 빠르게 자라서 화면 낭독기가 읽지 않게 한다 (조회 상태와 답만 알린다)
    <div aria-hidden="true" className="flex flex-col gap-0.5 text-cap text-ink-3">
      <span>
        {active ? '생각 중' : '생각'} · {wholeSeconds(thinkingMs(step, now))}초
      </span>
      <p ref={textRef} className="max-h-24 overflow-y-auto leading-snug break-words whitespace-pre-wrap">
        {step.text}
      </p>
    </div>
  );
}

function LiveTool({ step }: { step: Extract<AiTimelineStep, { kind: 'tool' }> }) {
  const { result } = step;
  // 웹 도구는 개수·호스트만 보인다 (제목은 웹에서 온 글이라 이 줄에는 쓰지 않는다)
  const webSummary = result ? (webToolDoneText(step.name, result.webSources) ?? notionToolDoneText(step.name, result.webSources) ?? driveToolDoneText(step.name, result.webSources)) : null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-ink-2">
      <Icon name={result ? 'check-circle' : 'search'} size="sm" className="mt-0.5 flex-none text-ink-3" />
      <span className="min-w-0 break-words">
        <b className="font-semibold">{toolTitleOf(step.name)}</b>
        {result
          ? ` · 완료 ${formatDuration(result.durationMs)}${webSummary ? ` · ${webSummary}` : result.label ? ` · ${result.label}` : ''}`
          : (webToolRunningText(step.name) ?? browserToolRunningText(step.name) ?? notionToolRunningText(step.name) ?? driveToolRunningText(step.name) ?? historyToolRunningText(step.name) ?? ' … 조회 중')}
      </span>
    </p>
  );
}

/** 답을 기다리는 동안의 진행 상황. 아무것도 오지 않았으면 '만들고 있어요'만 보인다 */
export function AiLiveView({ live }: { live: AiChatLive }) {
  const empty = live.steps.length === 0 && live.answer === '' && live.browserFrames.length === 0;
  return (
    <div aria-live="polite" className="flex flex-col gap-1.5 text-sm">
      {empty ? <p className="text-ink-2">답을 만들고 있어요…</p> : null}
      {live.steps.map((step, index) =>
        step.kind === 'thinking' ? (
          <LiveThinking key={index} step={step} />
        ) : step.kind === 'note' ? (
          <p key={index} className="text-cap leading-snug break-words whitespace-pre-wrap text-ink-3">
            {step.text}
          </p>
        ) : (
          <LiveTool key={step.id} step={step} />
        ),
      )}
      <AiBrowserLiveCard frames={live.browserFrames} actions={browserActionCount(live.steps)} />
      {live.answer ? <p className="leading-normal break-keep whitespace-pre-wrap wrap-anywhere">{live.answer}</p> : null}
    </div>
  );
}

/** 사진 아래 제목·주소 줄. 웹에서 온 글이라 링크가 아니라 글로만 보인다 */
function BrowserFrameCaption({ frame }: { frame: AiBrowserFrame }) {
  return (
    <div className="flex min-w-0 flex-col text-cap text-ink-3">
      {frame.title ? <span className="truncate font-medium text-ink-2">{frame.title}</span> : null}
      {frame.url ? <span className="truncate font-mono">{frame.url}</span> : null}
    </div>
  );
}

/** 답을 기다리는 동안: 철강맨AI가 지금 보는 웹 페이지 화면 (가장 최근 한 장) */
export function AiBrowserLiveCard({ frames, actions }: { frames: readonly AiBrowserFrame[]; actions: number }) {
  const latest = frames.at(-1);
  if (!latest) return null;
  return (
    <section aria-label="브라우저 화면" className="flex flex-col gap-1.5 rounded-sm border border-line bg-surface-2 p-2">
      <div className="flex items-center justify-between text-cap text-ink-3">
        <b className="font-semibold text-ink-2">브라우저 화면</b>
        {actions > 0 ? <span aria-label={`브라우저 동작 ${actions}번, 최대 ${AI_BROWSER_MAX_ACTIONS}번`}>{Math.min(actions, AI_BROWSER_MAX_ACTIONS)}/{AI_BROWSER_MAX_ACTIONS}</span> : null}
      </div>
      <img src={browserFrameSrc(latest)} alt={latest.title ? `브라우저 화면: ${latest.title}` : '브라우저 화면'} className="w-full rounded-xs border border-line bg-surface" />
      <BrowserFrameCaption frame={latest} />
    </section>
  );
}

/** 답이 끝난 뒤: 접어 두는 '브라우저로 본 화면 N장'. 펼치면 작은 사진을 시간 순서로 보인다 */
export function AiBrowserFramesDetails({ frames }: { frames: readonly AiBrowserFrame[] | undefined }) {
  if (!frames || frames.length === 0) return null;
  return (
    <details className="border-t border-line pt-2">
      <summary className={SUMMARY}>{browserFramesSummary(frames.length)}</summary>
      <ul className="mt-1.5 grid grid-cols-2 gap-2">
        {frames.map((frame, index) => (
          <li key={index} className="flex min-w-0 flex-col gap-1">
            <img src={browserFrameSrc(frame)} alt={frame.title ? `브라우저 화면 ${index + 1}: ${frame.title}` : `브라우저 화면 ${index + 1}`} loading="lazy" className="w-full rounded-xs border border-line bg-surface" />
            <BrowserFrameCaption frame={frame} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function DetailStep({ step }: { step: AiTimelineStep }) {
  if (step.kind === 'thinking') {
    const seconds = wholeSeconds(thinkingMs(step, step.startedAt));
    return (
      <li className="flex flex-col gap-1 text-xs">
        <span className="text-ink-2">
          <b className="font-semibold">생각</b>
          {seconds > 0 ? ` · ${seconds}초` : ''}
          <span className="text-cap text-ink-3"> · 모델이 스스로 쓴 설명이라 실제 판단과 다를 수 있어요</span>
        </span>
        <pre className={PRE}>{step.text}</pre>
      </li>
    );
  }
  if (step.kind === 'note') {
    return (
      <li className="flex flex-col gap-1 text-xs">
        <b className="font-semibold text-ink-2">중간 메모</b>
        <span className="break-words whitespace-pre-wrap text-ink-3">{step.text}</span>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-1 text-xs">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <b className="font-semibold">{toolTitleOf(step.name)}</b>
        <span className="font-mono text-cap text-ink-3">{step.name}</span>
        {step.result ? <span className="text-ink-3">{formatDuration(step.result.durationMs)}</span> : null}
        {step.result?.label ? <span className="text-ink-3">· {step.result.label}</span> : null}
        {step.result && webToolDoneText(step.name, step.result.webSources) ? <span className="text-ink-3">· {webToolDoneText(step.name, step.result.webSources)}</span> : null}
      </span>
      <span className="font-mono text-cap break-all text-ink-3">입력 {step.arguments}</span>
      {step.result ? <pre className={PRE}>{step.result.resultPreview}</pre> : null}
    </li>
  );
}

/** 답 아래: 답을 만들며 거친 생각·조회·중간 메모. 서버에 남지 않고 이 답에만 있다 */
export function AiStepsDetails({ steps }: { steps: readonly AiTimelineStep[] | undefined }) {
  if (!steps || steps.length === 0) return null;
  return (
    <details className="border-t border-line pt-2">
      <summary className={SUMMARY}>{aiStepsSummary(steps)}</summary>
      <ol className="mt-1.5 flex flex-col gap-2">
        {steps.map((step, index) => (
          <DetailStep key={index} step={step} />
        ))}
      </ol>
    </details>
  );
}
