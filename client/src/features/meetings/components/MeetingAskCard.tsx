'use client';

// 이 회의에 대해 묻기 (Voice2ERP 묶음 3). 서버의 AI 어시스턴트에 회의록 id를 함께 보내 이 회의 내용으로 답하게 한다.
// 전역 AI 패널과 대화가 섞이지 않게 대화는 이 카드 안(메모리)에만 둔다. 서버에도 저장하지 않는다 (요구사항 21장 미결정).
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AiAssistantTurn } from '@fantasteel/shared';
import type { MeetingMinutesView } from '@/api/meetingMinutes';
import { aiAssistantApi } from '@/api/aiAssistant';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { AiMark } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { QUESTION_CHIP, SOURCE_ICON, sourceText } from '@/features/shell/AiPanel';
import { MEETING_SUGGESTED_QUESTIONS, meetingScreenContext, splitCitations } from '@/lib/meetingAsk';
import { aiChatHistory, newAiChatId, type AiChatEntry } from '@/stores/useAiChatStore';
import { errorMessageOf } from '@/stores/useToastStore';

/** 서버 DTO와 같은 상한 (가정값) */
const MAX_QUESTION_LENGTH = 1000;

function Answer({ content, segmentCount, onJump }: { content: string; segmentCount: number; onJump: (index: number) => void }) {
  return (
    <p className="text-sm leading-normal whitespace-pre-wrap">
      {splitCitations(content, segmentCount).map((part, index) =>
        part.kind === 'text' ? (
          part.text
        ) : (
          <button
            key={index}
            type="button"
            title="원본 전사의 이 발언으로 이동"
            onClick={() => onJump(part.segmentIndex)}
            className="mx-0.5 inline-flex h-5 items-center rounded-xs border border-line-strong bg-surface px-1.5 align-baseline font-mono text-cap text-ink-2 hover:border-ai hover:bg-ai-bg hover:text-ai-strong"
          >
            {part.text}
          </button>
        ),
      )}
    </p>
  );
}

export function MeetingAskCard({ minutes, onJump }: { minutes: MeetingMinutesView; onJump: (index: number) => void }) {
  const [entries, setEntries] = useState<AiChatEntry[]>([]);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const segmentCount = minutes.transcriptSegments.length;

  const mutation = useMutation({
    mutationFn: ({ question, history }: { question: string; history: AiAssistantTurn[] }) =>
      aiAssistantApi.ask({ question, history, meetingMinutesId: minutes.id, screen: meetingScreenContext(minutes) }),
    onSuccess: (reply) => setEntries((current) => [...current, { id: newAiChatId(), role: 'assistant', content: reply.answer, sources: reply.sources }]),
    onError: (error, { question }) => setEntries((current) => [...current, { id: newAiChatId(), role: 'failure', content: errorMessageOf(error), question }]),
  });
  const pending = mutation.isPending;

  useEffect(() => {
    if (entries.length) bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [entries.length, pending]);

  const ask = (question: string, base: AiChatEntry[] = entries) => {
    const text = question.trim();
    if (!text || pending) return;
    setEntries([...base, { id: newAiChatId(), role: 'user', content: text }]);
    setDraft('');
    mutation.mutate({ question: text, history: aiChatHistory(base) });
  };

  // 실패한 질문과 실패 줄을 지우고 같은 질문을 다시 보낸다
  const retry = (failureId: string, question: string) => {
    const index = entries.findIndex((entry) => entry.id === failureId);
    ask(question, entries.slice(0, Math.max(0, index - 1)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return; // 한글 조합 중 Enter는 보내지 않는다
    event.preventDefault();
    ask(draft);
  };

  return (
    <Card>
      <CardHead
        title={
          <span className="flex items-center gap-1.5">
            <AiMark size="sm" />이 회의에 대해 묻기
          </span>
        }
        meta="AI 답은 틀릴 수 있어요 · 근거 번호를 눌러 확인해요"
        actions={
          entries.length ? (
            <Button size="sm" icon="refresh" disabled={pending} onClick={() => setEntries([])}>
              새 대화
            </Button>
          ) : undefined
        }
      />
      <CardBody className="gap-3">
        {entries.length === 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {MEETING_SUGGESTED_QUESTIONS.map((question) => (
              <button key={question} type="button" disabled={pending} className={QUESTION_CHIP} onClick={() => ask(question)}>
                {question}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto">
            {entries.map((entry) =>
              entry.role === 'user' ? (
                <div key={entry.id} className="max-w-[85%] self-end rounded-md rounded-br-xs bg-brand-tint px-3 py-2 text-sm whitespace-pre-wrap text-ink">
                  {entry.content}
                </div>
              ) : entry.role === 'failure' ? (
                <div key={entry.id} role="alert" className="flex flex-col gap-2 rounded-md border border-danger bg-danger-bg px-3 py-2.5 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-danger">
                    <Icon name="alert" size="sm" />
                    답을 받지 못했어요
                  </span>
                  <p className="leading-normal text-ink-2">{entry.content}</p>
                  <Button size="sm" icon="refresh" className="self-start" disabled={pending} onClick={() => retry(entry.id, entry.question)}>
                    다시 묻기
                  </Button>
                </div>
              ) : (
                <div key={entry.id} className="flex flex-col gap-2 rounded-md border border-ai-line bg-surface px-3 py-2.5">
                  <Answer content={entry.content} segmentCount={segmentCount} onJump={onJump} />
                  {entry.sources.length ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-cap">
                      <span className="font-semibold text-ink-2">출처</span>
                      {entry.sources.map((source) => (
                        <span key={`${source.kind}-${source.id}`} className="inline-flex items-center gap-1 text-ink-2">
                          <Icon name={SOURCE_ICON[source.kind]} size="sm" className="text-ink-3" />
                          {sourceText(source)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ),
            )}
            {pending ? (
              <div aria-live="polite" className="rounded-md border border-ai-line bg-ai-bg px-3 py-2 text-sm text-ai-strong">
                답을 만들고 있어요…
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}
        <div className="flex flex-col rounded-md border border-line-strong bg-surface focus-within:border-ai">
          <textarea
            rows={2}
            value={draft}
            maxLength={MAX_QUESTION_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="이 회의에 대해 물어보세요 — 예: 박서영 대리가 맡은 일 정리해 줘"
            aria-label="이 회의에 대해 질문"
            className="resize-none border-0 bg-transparent px-3 py-2.5 text-base leading-snug outline-none"
          />
          <div className="flex items-center gap-1 px-1.5 pt-1 pb-1.5">
            <span className="text-cap text-ink-3">Enter 보내기 · Shift+Enter 줄바꿈</span>
            <Button variant="ai" size="sm" icon="send" className="ml-auto" disabled={!draft.trim() || pending} aria-label="보내기" onClick={() => ask(draft)} />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
