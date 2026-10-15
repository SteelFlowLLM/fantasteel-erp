'use client';

// Voice2ERP 회의록 /meetings[?id=<회의록 id>|?new=1] (REQ-VOC-002, BP-VOC-01). 글로 붙여 넣은 전사와 음성(녹음·파일)의 저장·목록·상세다.
// 음성은 서버가 백그라운드로 전사한다. AI 분석은 아직 없다. 목록은 서버 쪽으로 거르고 쪽을 넘긴다 (api/server/meetingMinutes.ts).
import { MEETING_MINUTES_STATUS, MEETING_MINUTES_STATUS_LABEL, type MeetingMinutesStatus } from '@fantasteel/shared';
import { useState } from 'react';
import type { MeetingMinutesListItem, MeetingMinutesView } from '@/api/meetingMinutes';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Input, Select } from '@/components/Input';
import { MasterPane, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote, StateView } from '@/components/StateView';
import { MeetingDetail } from '@/features/meetings/components/MeetingDetail';
import { MeetingForm } from '@/features/meetings/components/MeetingForm';
import { MeetingStatusBadge } from '@/features/meetings/components/MeetingStatusBadge';
import { useMeetingMinutesList } from '@/hooks/useMeetingMinutes';
import { useUrlParams } from '@/features/purchasing/hooks/useUrlParams';
import { cn } from '@/lib/cn';

const STATUS_OPTIONS = Object.values(MEETING_MINUTES_STATUS);

function MeetingMaster({ currentId, onNew }: { currentId: number | null; onNew: () => void }) {
  const { set } = useUrlParams();
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<MeetingMinutesStatus | ''>('');
  const [page, setPage] = useState(1);
  const list = useMeetingMinutesList({ keyword, meetingMinutesStatus: status || undefined, page });
  const total = list.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / (list.data?.size ?? 20)));
  const filtered = keyword !== '' || status !== '';

  return (
    <MasterPane
      head={
        <>
          <div className="flex items-center gap-2">
            <b className="text-sm font-semibold">회의록</b>
            <span className="text-cap text-ink-3">{total}건</span>
            <Button size="sm" variant="primary" icon="plus" className="ml-auto" onClick={onNew}>
              새 회의록
            </Button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setKeyword(keywordInput.trim());
              setPage(1);
            }}
          >
            <Input leadingIcon="search" type="search" placeholder="제목 검색 (Enter)" aria-label="회의록 제목 검색" value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)} />
          </form>
          <Select
            aria-label="상태"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as MeetingMinutesStatus | '');
              setPage(1);
            }}
          >
            <option value="">모든 상태</option>
            {STATUS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {MEETING_MINUTES_STATUS_LABEL[value]}
              </option>
            ))}
          </Select>
        </>
      }
    >
      <QueryBoundary query={list} loadingLabel="회의록을 불러오는 중…">
        {(data) => (
          <>
            {data.items.length === 0 ? <EmptyNote>{filtered ? '조건에 맞는 회의록이 없어요' : '아직 회의록이 없어요. 새 회의록을 만들어 보세요'}</EmptyNote> : null}
            <ul className="flex flex-col">
              {data.items.map((row: MeetingMinutesListItem) => (
                <li key={row.id}>
                  <button
                    type="button"
                    aria-current={row.id === currentId ? 'page' : undefined}
                    onClick={() => set({ id: row.id, new: null })}
                    className={cn('flex w-full flex-col gap-1 border-b border-line px-4 py-2.5 text-left hover:bg-surface-2 aria-[current=page]:bg-brand-tint aria-[current=page]:hover:bg-brand-tint-hover')}
                  >
                    <span className="flex items-center gap-1.5">
                      <b className="min-w-0 flex-1 truncate text-sm font-semibold">{row.meetingMinutesTitle}</b>
                      <MeetingStatusBadge status={row.meetingMinutesStatus} />
                    </span>
                    <span className="text-cap text-ink-3 tabular-nums">
                      {row.meetingDate} · 참석 {row.attendeeCount}명 · 작성 {row.creatorName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {lastPage > 1 ? (
              <div className="flex items-center gap-2 px-4 py-2.5 text-cap text-ink-3">
                <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  이전
                </Button>
                <span className="tabular-nums">
                  {page} / {lastPage}
                </span>
                <Button size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
                  다음
                </Button>
              </div>
            ) : null}
            <p className="px-4 py-2.5 text-cap text-ink-3">회의일 최신순</p>
          </>
        )}
      </QueryBoundary>
    </MasterPane>
  );
}

export function MeetingScreen() {
  const { get, getNumber, set } = useUrlParams();
  const id = getNumber('id');
  const creating = get('new') === '1';

  return (
    <>
      <MeetingMaster currentId={id} onNew={() => set({ new: 1, id: null })} />
      <PageMain>
        {creating ? (
          <MeetingForm onCreated={(created: MeetingMinutesView) => set({ id: created.id, new: null })} onCancel={() => set({ new: null })} />
        ) : id !== null ? (
          <MeetingDetail id={id} onBack={() => set({ id: null })} />
        ) : (
          <StateView
            kind="empty"
            icon="mic"
            title="회의록을 골라 주세요"
            text="왼쪽 목록에서 회의록을 고르거나 새 회의록을 만들어 주세요. 녹음하거나 음성 파일을 올리거나 글로 붙여 넣을 수 있어요."
            actions={
              <Button variant="primary" icon="plus" onClick={() => set({ new: 1, id: null })}>
                새 회의록
              </Button>
            }
          />
        )}
      </PageMain>
    </>
  );
}
