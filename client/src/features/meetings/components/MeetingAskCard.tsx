'use client';

// 이 회의에 대해 묻기 (Voice2ERP 묶음 3). 서버의 AI 어시스턴트에 회의록 id를 함께 보내 이 회의 내용으로 답하게 한다.
// 대화는 서버가 사원·회의록마다 하나로 저장하고(철강맨AI 대화와 같은 기준), 다시 열면 이어 보인다. 전역 AI 패널 대화와는 섞이지 않는다.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { MeetingMinutesView } from '@/api/meetingMinutes';
import { aiAssistantApi } from '@/api/aiAssistant';
import { isAbortError } from '@/api/http';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { AiMark } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { AiLiveView, AiStepsDetails } from '@/features/shell/AiAnswerTrace';
import { QUESTION_CHIP, SOURCE_ICON, sourceText } from '@/features/shell/aiSourceDisplay';
import { MEETING_SUGGESTED_QUESTIONS, meetingScreenContext, splitCitations } from '@/lib/meetingAsk';
import { useDeleteAiChatThread } from '@/hooks/useAiAssistant';
import { AI_CHAT_STOPPED_REASON, aiAnswerEntryFromReply, aiChatEntriesFromThread, emptyAiChatLive, newAiChatId, reduceAiChatLive, type AiChatEntry, type AiChatLive } from '@/stores/useAiChatStore';
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
  /** 저장한 대화 id. 아직 묻지 않았거나 지웠으면 null */
  const [threadId, setThreadId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const removeThread = useDeleteAiChatThread();
  const bottomRef = useRef<HTMLDivElement>(null);
  const segmentCount = minutes.transcriptSegments.length;

  // 이 카드는 전역 대화 저장소를 쓰지 않아 진행 상황도 여기서 쌓는다. 생각 정도는 보내지 않는다 (서버 고정 기본값)
  const [live, setLive] = useState<AiChatLive | null>(null);
  const liveRef = useRef<AiChatLive | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const pending = live !== null;

  const updateLive = (next: AiChatLive | null) => {
    liveRef.current = next;
    setLive(next);
  };
  const appendEntry = (entry: AiChatEntry) => setEntries((current) => [...current, entry]);

  // 카드를 떠나면 서버에서 하던 일도 멈춘다
  useEffect(() => () => controllerRef.current?.abort(), []);

  // 이 회의에 물었던 대화를 되살린다. 못 읽으면 빈 대화로 두고 새 질문은 그대로 저장된다
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    aiAssistantApi.getMeetingThread(minutes.id).then(
      (thread) => {
        if (cancelled) return;
        setEntries(thread ? aiChatEntriesFromThread(thread) : []);
        setThreadId(thread?.id ?? null);
        setLoading(false);
      },
      () => {
        if (!cancelled) setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [minutes.id]);

  useEffect(() => {
    if (entries.length || live) bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [entries.length, live]);

  // 지난 대화는 서버가 저장한 것을 쓰므로 화면은 보내지 않는다
  const run = async (question: string) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    updateLive(emptyAiChatLive());
    let finished = false;
    const fail = (reason: string) => appendEntry({ id: newAiChatId(), role: 'failure', content: reason, question });
    try {
      await aiAssistantApi.askStream(
        { question, meetingMinutesId: minutes.id, saveThread: true, screen: meetingScreenContext(minutes) },
        (event) => {
          const current = liveRef.current;
          if (!current || finished) return;
          if (event.type === 'done') {
            finished = true;
            appendEntry(aiAnswerEntryFromReply(current, event.reply, Date.now(), newAiChatId()));
            if (event.thread) setThreadId(event.thread.id);
          } else if (event.type === 'error') {
            finished = true;
            fail(event.message);
          } else {
            updateLive(reduceAiChatLive(current, event, Date.now()));
          }
        },
        controller.signal,
      );
      if (!finished) fail('답이 끝나기 전에 연결이 끊겼어요. 다시 물어봐 주세요');
    } catch (error) {
      fail(controller.signal.aborted || isAbortError(error) ? AI_CHAT_STOPPED_REASON : errorMessageOf(error));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      updateLive(null);
    }
  };

  const ask = (question: string, base: AiChatEntry[] = entries) => {
    const text = question.trim();
    if (!text || pending || loading) return;
    setEntries([...base, { id: newAiChatId(), role: 'user', content: text }]);
    setDraft('');
    void run(text);
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
            <Button size="sm" icon="trash" disabled={pending || removeThread.isPending} onClick={() => (threadId === null ? setEntries([]) : setConfirmingDelete(true))}>
              대화 지우기
            </Button>
          ) : undefined
        }
      />
      <CardBody className="gap-3">
        {loading ? (
          <p className="text-cap text-ink-3">지난 질문을 불러오는 중…</p>
        ) : entries.length === 0 ? (
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
              ) : entry.role === 'failure' && entry.content === AI_CHAT_STOPPED_REASON ? (
                // 사용자가 직접 멈춘 것은 실패가 아니라 경고 색 없이 보인다
                <div key={entry.id} role="status" className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-ink-2">
                    <Icon name="x-circle" size="sm" />
                    답을 멈췄어요
                  </span>
                  <Button size="sm" icon="refresh" className="self-start" disabled={pending} onClick={() => retry(entry.id, entry.question)}>
                    다시 묻기
                  </Button>
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
                  <AiStepsDetails steps={entry.steps} />
                </div>
              ),
            )}
            {live ? (
              <div className="rounded-md border border-ai-line bg-ai-bg px-3 py-2.5">
                <AiLiveView live={live} />
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
            {pending ? (
              <Button variant="ai-outline" size="sm" icon="x-circle" className="ml-auto" aria-label="멈추기" onClick={() => controllerRef.current?.abort()}>
                멈추기
              </Button>
            ) : (
              <Button variant="ai" size="sm" icon="send" className="ml-auto" disabled={!draft.trim()} aria-label="보내기" onClick={() => ask(draft)} />
            )}
          </div>
        </div>
      </CardBody>
      {confirmingDelete && threadId !== null ? (
        <ConfirmDialog
          title="이 회의에 물은 대화를 지울까요?"
          confirmLabel="지우기"
          tone="danger"
          pending={removeThread.isPending}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() =>
            removeThread.mutate(threadId, {
              onSuccess: () => {
                setEntries([]);
                setThreadId(null);
                setConfirmingDelete(false);
              },
            })
          }
        >
          내가 이 회의에 물은 질문과 답이 모두 지워지고 되살릴 수 없어요. 다른 사람의 대화는 그대로예요.
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}
