'use client';

// 왼쪽 '내 초안' 목록: 내가 요청자(메시지 작성자)인 초안. 확인 대기를 먼저 고를 수 있게 상태 칩을 둔다.
import Link from 'next/link';
import { useState } from 'react';
import { DRAFT_STATUS, DRAFT_STATUS_LABEL, type DraftStatus } from '@/codes';
import { Badge } from '@/components/Badge';
import { Chip } from '@/components/Chip';
import { MasterPane } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { countByDraftStatus, DRAFT_STATUS_TONE } from '@/features/actionDrafts/lib/draftDisplay';
import { useMyActionDrafts } from '@/hooks/useActionDrafts';
import { cn } from '@/lib/cn';
import { relTime } from '@/lib/format';

type Filter = DraftStatus | 'ALL';

const STATUS_ORDER: readonly DraftStatus[] = [
  DRAFT_STATUS.WAITING_APPROVAL,
  DRAFT_STATUS.AI_GENERATED,
  DRAFT_STATUS.APPROVED,
  DRAFT_STATUS.EXECUTED,
  DRAFT_STATUS.REJECTED,
];

export function MyDraftList({ activeId }: { activeId: number | null }) {
  const drafts = useMyActionDrafts();
  const [filter, setFilter] = useState<Filter>('ALL');
  const counts = countByDraftStatus(drafts.data ?? []);

  return (
    <MasterPane
      className="hidden lg:flex"
      head={
        <>
          <div className="flex items-baseline gap-2">
            <h2 className="text-base font-semibold">내 초안</h2>
            <span className="text-xs text-ink-3">{counts.ALL}건</span>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="초안 상태">
            <Chip on={filter === 'ALL'} onClick={() => setFilter('ALL')}>
              전체 <b>{counts.ALL}</b>
            </Chip>
            {STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => (
              <Chip key={status} on={filter === status} onClick={() => setFilter(status)}>
                {DRAFT_STATUS_LABEL[status]} <b>{counts[status]}</b>
              </Chip>
            ))}
          </div>
          <p className="text-cap text-ink-3">메시지를 보낸 내가 요청자인 초안이에요. 내가 확정해야 구매요청이 만들어져요.</p>
        </>
      }
    >
      <QueryBoundary query={drafts} loadingLabel="초안을 불러오는 중…">
        {(list) => {
          const shown = filter === 'ALL' ? list : list.filter((draft) => draft.draftStatus === filter);
          if (shown.length === 0) {
            return (
              <EmptyNote className="m-4">
                {list.length === 0 ? '아직 내가 요청자인 초안이 없어요. 메신저 메시지의 더 보기 메뉴에서 구매요청 초안을 만들 수 있어요.' : '이 상태의 초안이 없어요'}
              </EmptyNote>
            );
          }
          return (
            <ul aria-label="내 초안 목록">
              {shown.map((draft) => (
                <li key={draft.id}>
                  <Link
                    href={`/action-drafts/${draft.id}`}
                    aria-current={draft.id === activeId ? 'page' : undefined}
                    className={cn(
                      'flex flex-col gap-1 border-b border-line px-4 py-2.5 hover:bg-surface-2',
                      draft.id === activeId && 'bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)] hover:bg-brand-tint-hover',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <b className="text-sm font-semibold">초안 #{draft.id}</b>
                      <span className="truncate text-cap text-ink-3">{draft.actionTypeLabel}</span>
                      <Badge tone={DRAFT_STATUS_TONE[draft.draftStatus]} className="ml-auto">
                        {DRAFT_STATUS_LABEL[draft.draftStatus]}
                      </Badge>
                    </span>
                    <span className="truncate text-xs text-ink-2">“{draft.messageContent ?? '원본 메시지 없음'}”</span>
                    <span className="flex items-center gap-1.5 text-cap text-ink-3">
                      <span className="truncate">{draft.chatRoomName ?? '채팅방'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="flex-none">{relTime(draft.createdAt)}</span>
                      {draft.purchaseRequisitionNo ? <span className="ml-auto flex-none font-mono text-ink-2">{draft.purchaseRequisitionNo}</span> : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryBoundary>
    </MasterPane>
  );
}
