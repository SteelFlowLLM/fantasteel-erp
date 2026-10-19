'use client';

// 철강맨AI 대화 목록 (이슈 #399, 문서에 없는 기능). 서버에 저장한 내 대화를 마지막으로 묻고 답한 순서로 보이고, 열기·지우기를 한다.
// 다시 연 대화에는 생각 과정·사진·브라우저 화면 사진이 없다 (저장하지 않는다).
import type { AiChatThreadSummaryView } from '@fantasteel/shared';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { EmptyNote, Spinner } from '@/components/StateView';
import { useAiChatThreads, useDeleteAiChatThread } from '@/hooks/useAiAssistant';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

interface AiChatThreadListProps {
  /** 지금 패널에 보이는 대화 */
  currentThreadId: number | null;
  /** 답을 기다리는 중이면 다른 대화를 열 수 없다 */
  busy: boolean;
  opening: boolean;
  onOpen: (threadId: number) => void;
}

export function AiChatThreadList({ currentThreadId, busy, opening, onOpen }: AiChatThreadListProps) {
  const threads = useAiChatThreads(true);
  const remove = useDeleteAiChatThread();
  const [removing, setRemoving] = useState<AiChatThreadSummaryView | null>(null);
  const items = threads.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <b className="text-sm font-semibold">대화 목록</b>
        <span className="text-cap text-ink-3">다시 열면 질문·답·출처·카드만 보여요</span>
      </div>
      {busy ? <p className="text-cap text-ink-3">답을 받는 중이에요. 답이 끝나면 다른 대화를 열 수 있어요.</p> : null}
      {threads.isPending ? (
        <Spinner className="self-center py-6" />
      ) : threads.isError ? (
        <div role="alert" className="flex flex-col items-center gap-2 py-6 text-cap text-danger">
          대화 목록을 불러오지 못했어요
          <Button size="sm" icon="refresh" onClick={() => void threads.refetch()}>
            다시 불러오기
          </Button>
        </div>
      ) : items.length === 0 ? (
        <EmptyNote>저장한 대화가 없어요. 질문하면 답이 끝날 때 저장돼요.</EmptyNote>
      ) : (
        <ul aria-label="저장한 대화" className="flex flex-col divide-y divide-line rounded-sm border border-line">
          {items.map((thread) => {
            const current = thread.id === currentThreadId;
            return (
              <li key={thread.id} className={cn('flex items-center gap-1 pr-1', current && 'bg-steelman-soft')}>
                <button
                  type="button"
                  disabled={busy || opening}
                  aria-current={current ? 'true' : undefined}
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-3 py-2 text-left enabled:hover:bg-surface-2 disabled:cursor-not-allowed"
                  onClick={() => onOpen(thread.id)}
                >
                  <span className="flex w-full min-w-0 items-center gap-1.5">
                    <Icon name="chat" size="sm" className="flex-none text-ink-3" />
                    <span className="truncate text-sm font-medium text-ink">{thread.title}</span>
                    {current ? <span className="flex-none text-cap font-semibold text-steelman-ink">지금 대화</span> : null}
                  </span>
                  <span className="pl-5 text-cap text-ink-3">{fmtDateTime(thread.updatedAt)}</span>
                </button>
                <IconButton icon="trash" label={`'${thread.title}' 대화 지우기`} size="sm" disabled={remove.isPending} onClick={() => setRemoving(thread)} />
              </li>
            );
          })}
        </ul>
      )}
      {threads.hasNextPage ? (
        <Button size="sm" className="self-center" disabled={threads.isFetchingNextPage} onClick={() => void threads.fetchNextPage()}>
          {threads.isFetchingNextPage ? '불러오는 중…' : '더 보기'}
        </Button>
      ) : null}
      {removing ? (
        <ConfirmDialog
          title="이 대화를 지울까요?"
          confirmLabel="지우기"
          tone="danger"
          pending={remove.isPending}
          onConfirm={() => remove.mutate(removing.id, { onSettled: () => setRemoving(null) })}
          onCancel={() => setRemoving(null)}
        >
          <p>
            <b>{removing.title}</b> 대화의 질문과 답을 모두 지워요. 지운 대화는 되살릴 수 없어요.
          </p>
          <p className="mt-1 text-ink-3">실행 카드로 만든 업무·일정은 지우지 않아요.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
