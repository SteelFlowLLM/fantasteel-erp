'use client';

// 철강맨AI 패널 = AI 어시스턴트 (REQ-AST-001·003·004·007·008·009). 더 넓게(SPEC 4장 4번), 여는 버튼은 상단 바(4장 5번).
// 용어 사전과 데이터 조회(REQ-AST-004 조회 대상 전부), 과거 사례 검색(AST-006, 예시 사례 + 등록 사례)으로 답한다. 실행 카드(AST-005)는 다음 단계라 준비 중으로 둔다.
// 화면 도우미 펫 철강맨과 한 캐릭터로 느끼도록 펫 말풍선·대화창(public/pet/pet-engine.js의 .fp-bubble·.fp-chat)과 같은 모양으로 그린다.
import { AI_REASONING_DEFAULT, AI_REASONING_LABEL, AI_REASONING_LEVELS, type AiAssistantScreenContext, type AiAssistantSource, type AiReasoningLevel } from '@fantasteel/shared';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { ROLE_LABEL } from '@/codes';
import { AiLiveView, AiStepsDetails } from '@/features/shell/AiAnswerTrace';
import { routeTitleOf } from '@/features/shell/routeTitles';
import { SteelmanAiMark } from '@/features/shell/SteelmanAiMark';
import { useAiSuggestedQuestions, useAskAiAssistant } from '@/hooks/useAiAssistant';
import { useMe } from '@/hooks/useMe';
import { readAiReasoningPreference, reasoningAfterSend, writeAiReasoningPreference } from '@/lib/aiReasoning';
import { AI_CHAT_STOPPED_REASON, useAiChatStore, type AiChatEntry, type AiChatLive } from '@/stores/useAiChatStore';
import { useShellStore } from '@/stores/useShellStore';

/** 서버 DTO와 같은 상한 (가정값) */
const MAX_QUESTION_LENGTH = 1000;

/** 답에 붙는 출처 종류 (REQ-AST-009) */
export const SOURCE_ICON: Record<AiAssistantSource['kind'], IconName> = { GLOSSARY: 'book', PROCESS: 'book', MANUAL: 'book', DATA: 'database' };
const SOURCE_LABEL: Record<AiAssistantSource['kind'], string> = { GLOSSARY: '용어 사전', PROCESS: '업무 프로세스', MANUAL: '업무 매뉴얼', DATA: '조회 데이터' };

/** 용어 사전·업무 프로세스는 ID를 함께 보이고, 조회 데이터의 id는 도구 이름(영문)이라 보이지 않는다 */
export const sourceText = (source: AiAssistantSource): string =>
  `${SOURCE_LABEL[source.kind]} · ${source.label}${source.kind === 'DATA' ? '' : ` (${source.id})`}`;

/** 펫 대화창의 추천 질문 칩(.fp-chip)과 같은 모양. 질문이 길 수 있어 한 줄로 자르지 않고 줄을 바꾼다 */
export const QUESTION_CHIP =
  'inline-flex min-h-7 items-center gap-1.5 rounded-[14px] border border-line-strong bg-surface px-2.5 py-1 text-left text-xs leading-snug font-medium text-ink-2 enabled:hover:border-steelman enabled:hover:text-steelman-ink disabled:cursor-not-allowed disabled:opacity-60';

/** 펫 말풍선(.fp-bubble)처럼 아바타 쪽으로 꼬리를 낸다: 바깥 삼각형이 테두리, 안쪽 삼각형이 바탕색으로 테두리 틈을 메운다 */
const TAIL_SHAPE =
  'relative before:absolute before:top-2 before:-left-[11px] before:border-y-8 before:border-r-10 before:border-l-0 before:border-y-transparent ' +
  'after:absolute after:top-[11px] after:-left-[6px] after:border-y-5 after:border-r-7 after:border-l-0 after:border-y-transparent';
const ANSWER_BUBBLE = `${TAIL_SHAPE} rounded-lg border-2 border-steelman bg-surface shadow-[3px_3px_0_var(--color-steelman-shadow)] before:border-r-steelman after:border-r-surface`;
const FAILURE_BUBBLE = `${TAIL_SHAPE} rounded-lg border-2 border-danger bg-surface shadow-[3px_3px_0_var(--color-danger-line)] before:border-r-danger after:border-r-surface`;
const STOPPED_BUBBLE = `${TAIL_SHAPE} rounded-lg border-2 border-line-strong bg-surface-2 before:border-r-line-strong after:border-r-surface-2`;

/** 위로 스크롤해 읽는 중이면 새 내용이 와도 끌어내리지 않는다: 바닥에서 이만큼(px) 안이면 따라간다 */
const STICK_TO_BOTTOM_PX = 80;

export function AiPanel() {
  const me = useMe();
  const pathname = usePathname();
  const close = useShellStore((state) => state.closeAiPanel);
  const context = useShellStore((state) => state.aiContext);
  const expanded = useShellStore((state) => state.aiPanelExpanded);
  const toggleExpanded = useShellStore((state) => state.toggleAiPanelExpanded);
  const entries = useAiChatStore((state) => state.entries);
  const pendingId = useAiChatStore((state) => state.pendingId);
  const live = useAiChatStore((state) => state.live);
  const claim = useAiChatStore((state) => state.claim);
  const clear = useAiChatStore((state) => state.clear);
  const removeFailure = useAiChatStore((state) => state.removeFailure);
  const ask = useAskAiAssistant();
  const [draft, setDraft] = useState('');
  const [reasoning, setReasoning] = useState<AiReasoningLevel>(AI_REASONING_DEFAULT);
  const [oneShot, setOneShot] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const roleLabel = ROLE_LABEL[me.roleCode];
  const screenTitle = routeTitleOf(pathname).title || '대시보드';
  const pending = pendingId !== null;

  useEffect(() => {
    claim(me.employeeId);
  }, [claim, me.employeeId]);

  // 저장된 생각 정도는 화면을 그린 뒤에 읽는다 (서버에서 먼저 그릴 때와 어긋나지 않게)
  useEffect(() => {
    const saved = readAiReasoningPreference();
    setReasoning(saved.level);
    setOneShot(saved.oneShot);
  }, []);

  // 답이 자라는 동안(생각·조회·답 글) 맨 아래를 따라간다
  const liveSize = live ? `${live.steps.length}:${live.answer.length}:${lastStepSize(live)}` : '';
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && stickRef.current) scroller.scrollTop = scroller.scrollHeight;
  }, [entries.length, pending, liveSize]);

  const onScroll = () => {
    const scroller = scrollRef.current;
    if (scroller) stickRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < STICK_TO_BOTTOM_PX;
  };

  const changeReasoning = (level: AiReasoningLevel) => {
    setReasoning(level);
    writeAiReasoningPreference({ level, oneShot });
  };

  const changeOneShot = (checked: boolean) => {
    setOneShot(checked);
    writeAiReasoningPreference({ level: reasoning, oneShot: checked });
  };

  // 주소의 쿼리(열어 둔 수주 id 등)도 함께 보내 '이 수주'를 알아듣게 한다 (REQ-AST-007)
  const screenContext = (): AiAssistantScreenContext => ({
    path: `${pathname}${typeof window === 'undefined' ? '' : window.location.search}`,
    title: screenTitle,
    label: context?.label ?? null,
  });

  const send = (question: string) => {
    if (!question.trim() || pending) return;
    stickRef.current = true;
    ask(question, screenContext(), reasoning);
    setDraft('');
    const next = reasoningAfterSend(reasoning, oneShot);
    if (next !== reasoning) {
      setReasoning(next);
      writeAiReasoningPreference({ level: next, oneShot });
    }
  };

  // 다시 물을 때는 처음 보냈던 생각 정도로 묻는다 (고른 값은 건드리지 않는다)
  const retry = (failureId: string, question: string, failedReasoning: AiReasoningLevel | undefined) => {
    removeFailure(failureId);
    stickRef.current = true;
    ask(question, screenContext(), failedReasoning ?? reasoning);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return; // 한글 조합 중 Enter는 보내지 않는다
    event.preventDefault();
    send(draft);
  };

  return (
    <aside
      aria-label="철강맨AI"
      // 펫이 패널 밑(보내기 버튼 위)에 서 있지 않게 비켜서게 한다 (pet-engine.js avoidEdges)
      data-pet-avoid=""
      className={`absolute inset-y-0 right-0 z-10 flex min-h-0 flex-col border-l-2 border-ink bg-surface shadow-[-4px_0_0_rgba(18,24,32,0.16),var(--shadow-pop)] ${expanded ? 'w-full' : 'w-[min(620px,46vw)]'}`}
    >
      <div className="flex min-h-12 flex-none items-center gap-1 border-b-2 border-line bg-surface-2 py-1.5 pr-2 pl-3">
        <SteelmanAiMark framed />
        <div className="ml-1 flex min-w-0 flex-col">
          <b className="text-base leading-tight font-bold">철강맨AI</b>
          <small className="truncate text-cap text-ink-3">화면 도우미 철강맨이 답해요</small>
        </div>
        <IconButton icon="refresh" label="새 대화" size="sm" className="ml-auto" disabled={!entries.length || pending} onClick={clear} />
        <IconButton icon={expanded ? 'minimize' : 'maximize'} label={expanded ? '작게 보기' : '크게 펼치기'} size="sm" onClick={toggleExpanded} />
        <IconButton icon="x" label="패널 닫기" size="sm" onClick={close} />
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto">
        <div className={`mx-auto flex flex-col gap-3.5 p-4 ${expanded ? 'max-w-[880px]' : ''}`}>
          {entries.length ? null : <Welcome roleLabel={roleLabel} contextQuestion={context?.question ?? null} disabled={pending} onAsk={send} />}
          {entries.map((entry) => (
            <ChatEntry key={entry.id} entry={entry} disabled={pending} onRetry={retry} />
          ))}
          {pending && live ? <LiveAnswer live={live} /> : null}
        </div>
      </div>

      <div className={`mx-auto w-full flex-none px-4 pb-2.5 ${expanded ? 'max-w-[880px]' : ''}`}>
        <span className="mb-1.5 inline-flex max-w-full items-center gap-1.5 rounded-sm border border-line bg-surface-2 px-2 py-1 text-cap text-ink-2">
          <Icon name="eye" size="sm" />
          <span className="truncate">
            보고 있는 화면 · <b className="font-semibold">{screenTitle}</b>
            {context ? ` · ${context.label}` : null}
          </span>
          <span className="flex-none text-ink-3">(질문과 함께 보내요)</span>
        </span>
        <div className="flex flex-col rounded-md border border-line-strong bg-surface focus-within:border-steelman focus-within:shadow-[0_0_0_2px_var(--color-steelman-soft)]">
          <textarea
            rows={2}
            value={draft}
            maxLength={MAX_QUESTION_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="철강맨AI에게 묻기 — 예: 여재가 뭐야?"
            aria-label="철강맨AI에게 질문"
            className="resize-none border-0 bg-transparent px-3 py-2.5 text-base leading-snug outline-none"
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1.5 pt-1 pb-1.5">
            <ReasoningPicker level={reasoning} oneShot={oneShot} onLevel={changeReasoning} onOneShot={changeOneShot} />
            <span className="text-cap text-ink-3">Enter 보내기 · Shift+Enter 줄바꿈</span>
            {pending ? (
              <Button size="sm" icon="x-circle" className="ml-auto" aria-label="멈추기" onClick={() => ask.stop()}>
                멈추기
              </Button>
            ) : (
              <Button variant="primary" size="sm" icon="send" className="ml-auto" disabled={!draft.trim()} aria-label="보내기" onClick={() => send(draft)} />
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-none items-center gap-1.5 border-t border-line px-4 py-2 text-cap text-ink-3">
        <Icon name="lock" size="sm" />
        철강맨AI는 조회와 초안만 만들어요 · 반영은 사람이 확정 · 내 권한({roleLabel}) 범위
      </div>
    </aside>
  );
}

function Welcome({ roleLabel, contextQuestion, disabled, onAsk }: { roleLabel: string; contextQuestion: string | null; disabled: boolean; onAsk: (question: string) => void }) {
  const suggested = useAiSuggestedQuestions();
  const roleQuestions = suggested.data?.roleQuestions ?? [];
  const firstTimeQuestions = suggested.data?.firstTimeQuestions ?? [];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-cap leading-relaxed text-ink-3">
        용어는 용어 사전에서, 재고·수주·생산·검사·구매·출하·LOT 추적·작업 로그는 내 권한 범위의 데이터를 조회해 출처와 함께 답해요. "비슷한 사례 찾아줘"처럼 물으면 과거 사례에서 찾아 요약해요. 자료에 없는 내용은 확인할 수 없다고 답해요. 실행 카드는 준비 중이에요.
      </p>
      {suggested.isError ? <p className="text-cap text-danger">추천 질문을 불러오지 못했어요. 질문은 바로 입력할 수 있어요.</p> : null}
      {contextQuestion || roleQuestions.length ? (
        <>
          <b className="mt-1 text-xs font-semibold">추천 질문 · {roleLabel}</b>
          <QuestionChips questions={[...(contextQuestion ? [contextQuestion] : []), ...roleQuestions]} disabled={disabled} onAsk={onAsk} />
        </>
      ) : null}
      {firstTimeQuestions.length ? (
        <>
          <b className="mt-1.5 text-xs font-semibold">처음 쓰는 분께</b>
          <QuestionChips questions={firstTimeQuestions} disabled={disabled} onAsk={onAsk} />
        </>
      ) : null}
    </div>
  );
}

function QuestionChips({ questions, disabled, onAsk }: { questions: readonly string[]; disabled: boolean; onAsk: (question: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {questions.map((question) => (
        <button key={question} type="button" disabled={disabled} className={QUESTION_CHIP} onClick={() => onAsk(question)}>
          {question}
        </button>
      ))}
    </div>
  );
}

/** 마지막 단계의 글 길이: 생각 글이 자라는 것도 따라가려고 */
function lastStepSize(live: AiChatLive): number {
  const last = live.steps.at(-1);
  return last && last.kind !== 'tool' ? last.text.length : 0;
}

/** 생각 정도: 끔·낮게·보통·깊게. '이번 질문만'을 켜 두면 보낸 뒤 기본값으로 돌아간다 */
function ReasoningPicker({ level, oneShot, onLevel, onOneShot }: { level: AiReasoningLevel; oneShot: boolean; onLevel: (level: AiReasoningLevel) => void; onOneShot: (checked: boolean) => void }) {
  return (
    <div className="inline-flex items-center gap-2 text-cap text-ink-3">
      <span id="ai-reasoning-label">생각</span>
      <div role="radiogroup" aria-labelledby="ai-reasoning-label" className="inline-flex overflow-hidden rounded-sm border border-line-strong">
        {AI_REASONING_LEVELS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === level}
            onClick={() => onLevel(option)}
            className={`h-6 px-2 text-cap not-first:border-l not-first:border-line-strong ${option === level ? 'bg-steelman-soft font-semibold text-steelman-ink' : 'bg-surface text-ink-2 hover:bg-surface-2'}`}
          >
            {AI_REASONING_LABEL[option]}
          </button>
        ))}
      </div>
      <label className="inline-flex items-center gap-1 text-ink-2">
        <input type="checkbox" checked={oneShot} onChange={(event) => onOneShot(event.target.checked)} />
        이번 질문만
      </label>
    </div>
  );
}

function ChatEntry({ entry, disabled, onRetry }: { entry: AiChatEntry; disabled: boolean; onRetry: (failureId: string, question: string, reasoning: AiReasoningLevel | undefined) => void }) {
  if (entry.role === 'user') {
    return <div className="max-w-[85%] self-end rounded-lg rounded-br-xs bg-brand-tint px-3 py-2 text-sm break-keep whitespace-pre-wrap wrap-anywhere text-brand">{entry.content}</div>;
  }
  if (entry.role === 'failure') {
    // 사용자가 직접 멈춘 것은 실패가 아니라 경고 색 없이 보인다
    const stopped = entry.content === AI_CHAT_STOPPED_REASON;
    return (
      <div className="flex gap-3">
        <SteelmanAiMark framed />
        <div role={stopped ? 'status' : 'alert'} className={`flex min-w-0 flex-1 flex-col gap-2 px-3 py-2.5 text-sm ${stopped ? STOPPED_BUBBLE : FAILURE_BUBBLE}`}>
          <span className={`inline-flex items-center gap-1.5 font-semibold ${stopped ? 'text-ink-2' : 'text-danger'}`}>
            <Icon name={stopped ? 'x-circle' : 'alert'} size="sm" />
            {stopped ? '답을 멈췄어요' : '답을 받지 못했어요'}
          </span>
          {stopped ? null : <p className="leading-normal break-keep wrap-anywhere text-ink-2">{entry.content}</p>}
          <Button size="sm" icon="refresh" className="self-start" disabled={disabled} onClick={() => onRetry(entry.id, entry.question, entry.reasoning)}>
            다시 묻기
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <SteelmanAiMark framed />
      <div className={`flex min-w-0 flex-1 flex-col gap-2 px-3 py-2.5 ${ANSWER_BUBBLE}`}>
        <p className="text-sm leading-normal break-keep whitespace-pre-wrap wrap-anywhere">{entry.content}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-cap">
          <span className="font-semibold text-ink-2">출처</span>
          {entry.sources.length ? (
            entry.sources.map((source) => (
              <span key={`${source.kind}-${source.id}`} className="inline-flex items-center gap-1 text-ink-2">
                <Icon name={SOURCE_ICON[source.kind]} size="sm" className="text-ink-3" />
                {sourceText(source)}
              </span>
            ))
          ) : (
            <span className="text-ink-3">없음 · 자료에서 찾은 내용이 아니에요</span>
          )}
        </div>
        <AiStepsDetails steps={entry.steps} />
        {entry.reasoningApplied === false && entry.requestedReasoning && entry.requestedReasoning !== AI_REASONING_DEFAULT ? (
          <p className="text-cap text-ink-3">이 모델은 생각 정도를 바꿀 수 없어 기본값으로 답했어요</p>
        ) : null}
      </div>
    </div>
  );
}

function LiveAnswer({ live }: { live: AiChatLive }) {
  return (
    <div className="flex gap-3">
      <SteelmanAiMark framed />
      <div className={`min-w-0 flex-1 px-3 py-2.5 ${ANSWER_BUBBLE}`}>
        <AiLiveView live={live} />
      </div>
    </div>
  );
}
