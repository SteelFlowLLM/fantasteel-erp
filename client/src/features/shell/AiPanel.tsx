'use client';

// 철강맨AI 패널 = AI 어시스턴트 (REQ-AST-001·003·004·007·008·009). 더 넓게(SPEC 4장 4번), 여는 버튼은 상단 바(4장 5번).
// 용어 사전과 데이터 조회(REQ-AST-004 조회 대상 전부)로 답한다. 실행 카드(AST-005)·사례 검색(AST-006)은 다음 단계라 준비 중으로 둔다.
// 화면 도우미 펫 철강맨과 한 캐릭터로 느끼도록 펫 말풍선·대화창(public/pet/pet-engine.js의 .fp-bubble·.fp-chat)과 같은 모양으로 그린다.
import type { AiAssistantScreenContext, AiAssistantSource } from '@fantasteel/shared';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { ROLE_LABEL } from '@/codes';
import { routeTitleOf } from '@/features/shell/routeTitles';
import { SteelmanAiMark } from '@/features/shell/SteelmanAiMark';
import { useAiSuggestedQuestions, useAskAiAssistant } from '@/hooks/useAiAssistant';
import { useMe } from '@/hooks/useMe';
import { useAiChatStore, type AiChatEntry } from '@/stores/useAiChatStore';
import { useShellStore } from '@/stores/useShellStore';

/** 서버 DTO와 같은 상한 (가정값) */
const MAX_QUESTION_LENGTH = 1000;

/** 답에 붙는 출처 종류 (REQ-AST-009) */
const SOURCE_ICON: Record<AiAssistantSource['kind'], IconName> = { GLOSSARY: 'book', PROCESS: 'book', MANUAL: 'book', DATA: 'database' };
const SOURCE_LABEL: Record<AiAssistantSource['kind'], string> = { GLOSSARY: '용어 사전', PROCESS: '업무 프로세스', MANUAL: '업무 매뉴얼', DATA: '조회 데이터' };

/** 용어 사전·업무 프로세스는 ID를 함께 보이고, 조회 데이터의 id는 도구 이름(영문)이라 보이지 않는다 */
export const sourceText = (source: AiAssistantSource): string =>
  `${SOURCE_LABEL[source.kind]} · ${source.label}${source.kind === 'DATA' ? '' : ` (${source.id})`}`;

/** 펫 대화창의 추천 질문 칩(.fp-chip)과 같은 모양. 질문이 길 수 있어 한 줄로 자르지 않고 줄을 바꾼다 */
const QUESTION_CHIP =
  'inline-flex min-h-7 items-center gap-1.5 rounded-[14px] border border-line-strong bg-surface px-2.5 py-1 text-left text-xs leading-snug font-medium text-ink-2 enabled:hover:border-steelman enabled:hover:text-steelman-ink disabled:cursor-not-allowed disabled:opacity-60';

/** 펫 말풍선(.fp-bubble)처럼 아바타 쪽으로 꼬리를 낸다: 바깥 삼각형이 테두리, 안쪽 삼각형이 바탕색으로 테두리 틈을 메운다 */
const TAIL_SHAPE =
  'relative before:absolute before:top-2 before:-left-[11px] before:border-y-8 before:border-r-10 before:border-l-0 before:border-y-transparent ' +
  'after:absolute after:top-[11px] after:-left-[6px] after:border-y-5 after:border-r-7 after:border-l-0 after:border-y-transparent';
const ANSWER_BUBBLE = `${TAIL_SHAPE} rounded-lg border-2 border-steelman bg-surface shadow-[3px_3px_0_var(--color-steelman-shadow)] before:border-r-steelman after:border-r-surface`;
const FAILURE_BUBBLE = `${TAIL_SHAPE} rounded-lg border-2 border-danger bg-surface shadow-[3px_3px_0_var(--color-danger-line)] before:border-r-danger after:border-r-surface`;
const THINKING_BUBBLE = `${TAIL_SHAPE} rounded-lg border-2 border-steelman-shadow bg-steelman-soft before:border-r-steelman-shadow after:border-r-steelman-soft`;

export function AiPanel() {
  const me = useMe();
  const pathname = usePathname();
  const close = useShellStore((state) => state.closeAiPanel);
  const context = useShellStore((state) => state.aiContext);
  const expanded = useShellStore((state) => state.aiPanelExpanded);
  const toggleExpanded = useShellStore((state) => state.toggleAiPanelExpanded);
  const entries = useAiChatStore((state) => state.entries);
  const pendingId = useAiChatStore((state) => state.pendingId);
  const claim = useAiChatStore((state) => state.claim);
  const clear = useAiChatStore((state) => state.clear);
  const removeFailure = useAiChatStore((state) => state.removeFailure);
  const ask = useAskAiAssistant();
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const roleLabel = ROLE_LABEL[me.roleCode];
  const screenTitle = routeTitleOf(pathname).title || '대시보드';
  const pending = pendingId !== null;

  useEffect(() => {
    claim(me.employeeId);
  }, [claim, me.employeeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [entries.length, pending]);

  // 주소의 쿼리(열어 둔 수주 id 등)도 함께 보내 '이 수주'를 알아듣게 한다 (REQ-AST-007)
  const screenContext = (): AiAssistantScreenContext => ({
    path: `${pathname}${typeof window === 'undefined' ? '' : window.location.search}`,
    title: screenTitle,
    label: context?.label ?? null,
  });

  const send = (question: string) => {
    if (!question.trim() || pending) return;
    ask(question, screenContext());
    setDraft('');
  };

  const retry = (failureId: string, question: string) => {
    removeFailure(failureId);
    ask(question, screenContext());
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

      <div className="min-h-0 flex-1 overflow-auto">
        <div className={`mx-auto flex flex-col gap-3.5 p-4 ${expanded ? 'max-w-[880px]' : ''}`}>
          {entries.length ? null : <Welcome roleLabel={roleLabel} contextQuestion={context?.question ?? null} disabled={pending} onAsk={send} />}
          {entries.map((entry) => (
            <ChatEntry key={entry.id} entry={entry} disabled={pending} onRetry={retry} />
          ))}
          {pending ? <Thinking /> : null}
          <div ref={bottomRef} />
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
          <div className="flex items-center gap-1 px-1.5 pt-1 pb-1.5">
            <span className="text-cap text-ink-3">Enter 보내기 · Shift+Enter 줄바꿈</span>
            <Button variant="primary" size="sm" icon="send" className="ml-auto" disabled={!draft.trim() || pending} aria-label="보내기" onClick={() => send(draft)} />
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
        용어는 용어 사전에서, 재고·수주·생산·검사·구매·출하·LOT 추적·작업 로그는 내 권한 범위의 데이터를 조회해 출처와 함께 답해요. 자료에 없는 내용은 확인할 수 없다고 답해요. 실행 카드와 과거 사례 검색은 준비 중이에요.
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

function ChatEntry({ entry, disabled, onRetry }: { entry: AiChatEntry; disabled: boolean; onRetry: (failureId: string, question: string) => void }) {
  if (entry.role === 'user') {
    return <div className="max-w-[85%] self-end rounded-lg rounded-br-xs bg-brand-tint px-3 py-2 text-sm break-keep whitespace-pre-wrap wrap-anywhere text-brand">{entry.content}</div>;
  }
  if (entry.role === 'failure') {
    return (
      <div className="flex gap-3">
        <SteelmanAiMark framed />
        <div role="alert" className={`flex min-w-0 flex-1 flex-col gap-2 px-3 py-2.5 text-sm ${FAILURE_BUBBLE}`}>
          <span className="inline-flex items-center gap-1.5 font-semibold text-danger">
            <Icon name="alert" size="sm" />
            답을 받지 못했어요
          </span>
          <p className="leading-normal break-keep wrap-anywhere text-ink-2">{entry.content}</p>
          <Button size="sm" icon="refresh" className="self-start" disabled={disabled} onClick={() => onRetry(entry.id, entry.question)}>
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
      </div>
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex gap-3" aria-live="polite">
      <SteelmanAiMark framed />
      <div className={`px-3 py-2 text-sm text-steelman-ink ${THINKING_BUBBLE}`}>답을 만들고 있어요…</div>
    </div>
  );
}
