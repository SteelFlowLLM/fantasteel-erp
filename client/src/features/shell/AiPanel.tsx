'use client';

// AI 어시스턴트 패널 (REQ-AST-001·003·004·007·008·009). 더 넓게(SPEC 4장 4번), 여는 버튼은 상단 바(4장 5번).
// 용어 사전과 데이터 조회(REQ-AST-004 조회 대상 전부)로 답한다. 실행 카드(AST-005)·사례 검색(AST-006)은 다음 단계라 준비 중으로 둔다.
import type { AiAssistantScreenContext, AiAssistantSource } from '@fantasteel/shared';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AiMark } from '@/components/ComingSoon';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { ROLE_LABEL } from '@/codes';
import { routeTitleOf } from '@/features/shell/routeTitles';
import { useAiSuggestedQuestions, useAskAiAssistant } from '@/hooks/useAiAssistant';
import { useMe } from '@/hooks/useMe';
import { useAiChatStore, type AiChatEntry } from '@/stores/useAiChatStore';
import { useShellStore } from '@/stores/useShellStore';

/** 서버 DTO와 같은 상한 (가정값) */
const MAX_QUESTION_LENGTH = 1000;

/** 답에 붙는 출처 종류 (REQ-AST-009) */
export const SOURCE_ICON: Record<AiAssistantSource['kind'], IconName> = { GLOSSARY: 'book', PROCESS: 'book', MANUAL: 'book', DATA: 'database' };
const SOURCE_LABEL: Record<AiAssistantSource['kind'], string> = { GLOSSARY: '용어 사전', PROCESS: '업무 프로세스', MANUAL: '업무 매뉴얼', DATA: '조회 데이터' };

/** 용어 사전·업무 프로세스는 ID를 함께 보이고, 조회 데이터의 id는 도구 이름(영문)이라 보이지 않는다 */
export const sourceText = (source: AiAssistantSource): string =>
  `${SOURCE_LABEL[source.kind]} · ${source.label}${source.kind === 'DATA' ? '' : ` (${source.id})`}`;

export const QUESTION_CHIP =
  'inline-flex min-h-7 items-center gap-1.5 rounded-[14px] border border-ai-line bg-ai-bg px-2.5 py-1 text-left text-xs leading-snug font-medium text-ai-strong hover:border-ai disabled:cursor-not-allowed disabled:opacity-60';

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
      aria-label="AI 어시스턴트"
      className={`absolute inset-y-0 right-0 z-10 flex min-h-0 flex-col border-l border-ai-line bg-surface shadow-pop ${expanded ? 'w-full' : 'w-[min(620px,46vw)]'}`}
    >
      <div className="flex h-12 flex-none items-center gap-1 border-b border-ai-line bg-ai-bg pr-2 pl-3.5">
        <AiMark />
        <b className="ml-1 text-base font-semibold text-ai-strong">AI 어시스턴트</b>
        <IconButton icon="refresh" label="새 대화" size="sm" tone="ai" className="ml-auto" disabled={!entries.length || pending} onClick={clear} />
        <IconButton icon={expanded ? 'minimize' : 'maximize'} label={expanded ? '작게 보기' : '크게 펼치기'} size="sm" tone="ai" onClick={toggleExpanded} />
        <IconButton icon="x" label="패널 닫기" size="sm" tone="ai" onClick={close} />
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
        <div className="flex flex-col rounded-md border border-line-strong bg-surface focus-within:border-ai">
          <textarea
            rows={2}
            value={draft}
            maxLength={MAX_QUESTION_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="AI에게 묻기 — 예: 여재가 뭐야?"
            aria-label="AI에게 질문"
            className="resize-none border-0 bg-transparent px-3 py-2.5 text-base leading-snug outline-none"
          />
          <div className="flex items-center gap-1 px-1.5 pt-1 pb-1.5">
            <span className="text-cap text-ink-3">Enter 보내기 · Shift+Enter 줄바꿈</span>
            <Button variant="ai" size="sm" icon="send" className="ml-auto" disabled={!draft.trim() || pending} aria-label="보내기" onClick={() => send(draft)} />
          </div>
        </div>
      </div>
      <div className="flex flex-none items-center gap-1.5 border-t border-line px-4 py-2 text-cap text-ink-3">
        <Icon name="lock" size="sm" />
        AI는 조회와 초안만 만들어요 · 반영은 사람이 확정 · 내 권한({roleLabel}) 범위
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
    return <div className="max-w-[85%] self-end rounded-md rounded-br-xs bg-brand-tint px-3 py-2 text-sm whitespace-pre-wrap text-ink">{entry.content}</div>;
  }
  if (entry.role === 'failure') {
    return (
      <div className="flex gap-2">
        <AiMark size="sm" className="mt-0.5" />
        <div role="alert" className="flex min-w-0 flex-1 flex-col gap-2 rounded-md border border-danger bg-danger-bg px-3 py-2.5 text-sm">
          <span className="inline-flex items-center gap-1.5 font-semibold text-danger">
            <Icon name="alert" size="sm" />
            답을 받지 못했어요
          </span>
          <p className="leading-normal text-ink-2">{entry.content}</p>
          <Button size="sm" icon="refresh" className="self-start" disabled={disabled} onClick={() => onRetry(entry.id, entry.question)}>
            다시 묻기
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <AiMark size="sm" className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-md border border-ai-line bg-surface px-3 py-2.5">
        <p className="text-sm leading-normal whitespace-pre-wrap">{entry.content}</p>
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
    <div className="flex gap-2" aria-live="polite">
      <AiMark size="sm" className="mt-0.5" />
      <div className="rounded-md border border-ai-line bg-ai-bg px-3 py-2 text-sm text-ai-strong">답을 만들고 있어요…</div>
    </div>
  );
}
