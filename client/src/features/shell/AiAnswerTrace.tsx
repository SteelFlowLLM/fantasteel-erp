'use client';

// 답을 만드는 과정(생각·조회·중간 글) 보기. 전역 AI 패널과 회의 질문 카드가 함께 쓴다.
// - AiLiveView: 답을 기다리는 동안 보이는 진행 상황 (생각 시간이 흐르고, 조회 중 → 완료로 바뀌고, 답 글이 자란다)
// - AiStepsDetails: 답이 끝난 뒤 답 아래에 접어 두는 '생각 과정'
import { AI_AGENT_INPUT_TEXT_MAX, AI_ASSISTANT_TOOL_TITLE, type AiAgentControlCommand, type AiAgentInput, type AiAgentInputKey } from '@fantasteel/shared';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { AI_BROWSER_MAX_ACTIONS, browserActionCount, browserFrameSrc, browserFramesSummary, browserToolRunningText, pointFraction, type AiBrowserFrame } from '@/lib/aiBrowser';
import { driveToolDoneText, driveToolRunningText } from '@/lib/aiDrive';
import { notionToolDoneText, notionToolRunningText } from '@/lib/aiNotion';
import { webToolDoneText, webToolRunningText } from '@/lib/aiWebSearch';
import { formatDuration } from '@/lib/meetingAnalysis';
import type { AiAgentControlState, AiChatLive, AiTimelineStep } from '@/stores/useAiChatStore';

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

/** 사용자가 작업 중에 덧붙인 말 (이슈 #430). 서버가 모델에 넘기기 전에는 '전하는 중' */
function LiveUserNote({ step }: { step: Extract<AiTimelineStep, { kind: 'userNote' }> }) {
  return (
    <p className="flex items-start gap-1.5 rounded-xs bg-brand-tint px-2 py-1 text-xs text-brand">
      <Icon name="chat" size="sm" className="mt-0.5 flex-none" />
      <span className="min-w-0 break-words whitespace-pre-wrap">
        <b className="font-semibold">덧붙임</b> · {step.text}
        <span className="text-ink-3">{step.applied ? ' · AI에게 전했어요' : ' · 다음 차례에 전해요'}</span>
      </span>
    </p>
  );
}

/** 답을 기다리는 동안의 진행 상황. 아무것도 오지 않았으면 '만들고 있어요'만 보인다 */
export function AiLiveView({
  live,
  onControl,
  onInput,
  maxActions = AI_BROWSER_MAX_ACTIONS,
}: {
  live: AiChatLive;
  onControl?: (command: AiAgentControlCommand) => void;
  /** 멈춰 기다리는 동안 사람이 보내는 직접 조작 (이슈 #433). 없으면 화면은 보기만 한다 */
  onInput?: (input: AiAgentInput) => void;
  maxActions?: number;
}) {
  const empty = live.steps.length === 0 && live.answer === '' && live.browserFrames.length === 0 && live.liveFrame === null;
  return (
    <div aria-live="polite" className="flex flex-col gap-1.5 text-sm">
      {empty ? <p className="text-ink-2">답을 만들고 있어요…</p> : null}
      {live.steps.map((step, index) =>
        step.kind === 'thinking' ? (
          <LiveThinking key={index} step={step} />
        ) : step.kind === 'userNote' ? (
          <LiveUserNote key={index} step={step} />
        ) : step.kind === 'note' ? (
          <p key={index} className="text-cap leading-snug break-words whitespace-pre-wrap text-ink-3">
            {step.text}
          </p>
        ) : (
          <LiveTool key={step.id} step={step} />
        ),
      )}
      <AiBrowserLiveCard frames={live.browserFrames} liveFrame={live.liveFrame} actions={browserActionCount(live.steps)} max={maxActions} {...(live.control?.pausedBefore && onInput ? { onInput } : {})} />
      {live.control && onControl ? <AiAgentControlBar control={live.control} onControl={onControl} /> : null}
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

/**
 * 보일 화면: 실시간 화면이 동작 뒤 사진보다 새것이면 실시간 화면 (이슈 #425). 실시간 화면에는 제목이 없어 같은 주소의 사진 제목을 빌린다
 */
export function shownBrowserFrame(frames: readonly AiBrowserFrame[], liveFrame: AiBrowserFrame | null): { frame: AiBrowserFrame; live: boolean } | null {
  const latest = frames.at(-1) ?? null;
  if (liveFrame && (!latest || Date.parse(liveFrame.at) >= Date.parse(latest.at))) {
    return { frame: { ...liveFrame, title: latest && latest.url === liveFrame.url ? latest.title : '' }, live: true };
  }
  return latest ? { frame: latest, live: false } : null;
}

/** 답을 기다리는 동안: 철강맨AI가 지금 보는 웹 페이지 화면 (실시간 화면, 없으면 가장 최근 사진 한 장) */
export function AiBrowserLiveCard({
  frames,
  liveFrame = null,
  actions,
  max = AI_BROWSER_MAX_ACTIONS,
  onInput,
}: {
  frames: readonly AiBrowserFrame[];
  liveFrame?: AiBrowserFrame | null;
  actions: number;
  max?: number;
  /** 있으면 화면을 눌러 서버 Chrome을 직접 조작할 수 있다 (멈춰 기다리는 동안만, 이슈 #433) */
  onInput?: (input: AiAgentInput) => void;
}) {
  const shown = shownBrowserFrame(frames, liveFrame);
  if (!shown) return null;
  const { frame } = shown;
  const image = <img src={browserFrameSrc(frame)} alt={frame.title ? `브라우저 화면: ${frame.title}` : '브라우저 화면'} className="w-full rounded-xs border border-line bg-surface" />;
  return (
    <section aria-label="브라우저 화면" className="flex flex-col gap-1.5 rounded-sm border border-line bg-surface-2 p-2">
      <div className="flex items-center justify-between text-cap text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <b className="font-semibold text-ink-2">브라우저 화면</b>
          {shown.live ? (
            <span className="inline-flex items-center gap-1 font-medium text-steelman-ink">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-steelman motion-safe:animate-pulse" />
              실시간
            </span>
          ) : null}
        </span>
        {actions > 0 ? <span aria-label={`브라우저 동작 ${actions}번, 최대 ${max}번`}>{Math.min(actions, max)}/{max}</span> : null}
      </div>
      {onInput ? (
        <button
          type="button"
          aria-label="브라우저 화면 (눌러서 그 자리를 직접 누르기)"
          title="눌러서 그 자리를 직접 눌러요"
          className="block w-full cursor-crosshair p-0"
          onClick={(event) => {
            const point = pointFraction(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
            if (point) onInput({ kind: 'click', ...point });
          }}
        >
          {image}
        </button>
      ) : (
        image
      )}
      <BrowserFrameCaption frame={frame} />
      {onInput ? <AiBrowserTakeover onInput={onInput} /> : null}
    </section>
  );
}

/** 직접 넣는 글, 자주 쓰는 키, 스크롤 한 번의 거리(화면 픽셀, 가정값) */
const TAKEOVER_KEYS: readonly { key: AiAgentInputKey; label: string }[] = [
  { key: 'Enter', label: 'Enter' },
  { key: 'Tab', label: 'Tab' },
  { key: 'Backspace', label: '지우기' },
];
const TAKEOVER_SCROLL = 480;

/**
 * 멈춰 있는 동안 사람이 서버 Chrome을 직접 조작하는 줄 (이슈 #433). 화면을 누르면 그 자리를 누르고, 여기서 글·키·스크롤을 보낸다.
 * 입력한 글은 보내자마자 칸에서 지우고 저장하지 않는다. 로그인·결제도 사람이 직접 하면 된다
 */
function AiBrowserTakeover({ onInput }: { onInput: (input: AiAgentInput) => void }) {
  const [text, setText] = useState('');
  const send = () => {
    if (!text) return;
    onInput({ kind: 'type', text });
    setText('');
  };
  return (
    <div role="group" aria-label="직접 조작" className="flex flex-col gap-1.5 border-t border-line pt-1.5 text-cap text-ink-3">
      <p>멈춰 있어서 직접 할 수 있어요. 화면을 누르면 그 자리를 누르고, 입력한 글은 저장하지 않아요. [계속]을 누르면 철강맨AI가 화면을 다시 읽고 이어 가요.</p>
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <input
          type="text"
          value={text}
          maxLength={AI_AGENT_INPUT_TEXT_MAX}
          autoComplete="off"
          placeholder="고른 칸에 넣을 글"
          aria-label="화면에 넣을 글"
          onChange={(event) => setText(event.target.value)}
          className="h-6 min-w-0 flex-1 rounded-sm border border-line-strong bg-surface px-2 text-cap text-ink"
        />
        <button type="submit" className={CONTROL_BUTTON} disabled={!text}>
          넣기
        </button>
        {TAKEOVER_KEYS.map(({ key, label }) => (
          <button key={key} type="button" className={CONTROL_BUTTON} onClick={() => onInput({ kind: 'key', key })}>
            {label}
          </button>
        ))}
        <button type="button" className={CONTROL_BUTTON} aria-label="위로 스크롤" onClick={() => onInput({ kind: 'scroll', deltaY: -TAKEOVER_SCROLL })}>
          <Icon name="chevron-up" size="sm" />
        </button>
        <button type="button" className={CONTROL_BUTTON} aria-label="아래로 스크롤" onClick={() => onInput({ kind: 'scroll', deltaY: TAKEOVER_SCROLL })}>
          <Icon name="chevron-down" size="sm" />
        </button>
      </form>
    </div>
  );
}

const CONTROL_BUTTON = 'inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-line-strong bg-surface px-2 text-cap text-ink-2 hover:bg-surface-2';

/** 멈춤 줄의 안내 (이슈 #425) */
export function agentControlText(control: AiAgentControlState): string {
  if (control.pausedBefore) return `멈췄어요 · 다음 동작: ${toolTitleOf(control.pausedBefore)}`;
  if (control.requested) return '다음 브라우저·화면 동작 앞에서 멈춰요…';
  return '브라우저·화면 조작 중';
}

/** 답하는 동안 브라우저·화면 조작 멈추기·한 단계·계속 (이슈 #425). 답 전체를 멈추는 [멈추기]와 달리 답은 이어진다 */
function AiAgentControlBar({ control, onControl }: { control: AiAgentControlState; onControl: (command: AiAgentControlCommand) => void }) {
  const waiting = control.pausedBefore !== null || control.requested;
  return (
    <div role="group" aria-label="브라우저·화면 조작 멈춤" className="flex flex-wrap items-center gap-1.5 text-cap text-ink-3">
      <span aria-live="polite" className={control.pausedBefore ? 'font-semibold text-steelman-ink' : ''}>
        {agentControlText(control)}
      </span>
      {waiting ? (
        <>
          {control.pausedBefore ? (
            <button type="button" className={CONTROL_BUTTON} onClick={() => onControl('step')}>
              <Icon name="chevron-right" size="sm" />한 단계
            </button>
          ) : null}
          <button type="button" className={CONTROL_BUTTON} onClick={() => onControl('resume')}>
            <Icon name="arrow-right" size="sm" />계속
          </button>
        </>
      ) : (
        <button type="button" className={CONTROL_BUTTON} onClick={() => onControl('pause')}>
          <Icon name="clock" size="sm" />일시정지
        </button>
      )}
    </div>
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
  if (step.kind === 'userNote') {
    return (
      <li className="flex flex-col gap-1 text-xs">
        <b className="font-semibold text-ink-2">덧붙임</b>
        <span className="break-words whitespace-pre-wrap text-ink-3">{step.text}</span>
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
      {step.result?.resultPreview ? <pre className={PRE}>{step.result.resultPreview}</pre> : null}
    </li>
  );
}

/** 답 아래: 답을 만들며 거친 생각·조회·중간 메모. 저장한 대화는 생각 글과 도구 동작 기록만 다시 보인다 (이슈 #433) */
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
