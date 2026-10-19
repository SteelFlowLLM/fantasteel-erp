'use client';

// Drive에서 녹음 고르기 (이슈 #361). 관리자가 정한 회사 Drive 폴더 바로 아래의 녹음을 최신 수정순으로 보이고, 하나를 골라 회의록으로 가져온다.
import { useState } from 'react';
import type { DriveFileView } from '@/api/integrations';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { useDriveFiles } from '@/hooks/useIntegrations';
import { fmtDateTime } from '@/lib/format';
import { driveAudioProblem, driveFileSizeLabel } from '@/lib/integrations';

export function DriveAudioPicker({ selectedId, onPick, onClose }: { selectedId: string | null; onPick: (file: DriveFileView) => void; onClose: () => void }) {
  const files = useDriveFiles('audio', true);
  const [chosen, setChosen] = useState<DriveFileView | null>(null);
  const rows = files.data?.pages.flatMap((page) => page.files) ?? [];
  const current = chosen?.id ?? selectedId;

  return (
    <Modal
      title="Drive에서 녹음 고르기"
      width={640}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" disabled={!chosen} onClick={() => chosen && onPick(chosen)}>
            이 녹음 쓰기
          </Button>
        </>
      }
    >
      <span className="text-cap text-ink-3">회사 Drive 폴더에 올라온 녹음이에요. 최근에 고친 것부터 보여요</span>
      {files.isPending ? <span className="text-sm text-ink-3">녹음 목록을 불러오는 중…</span> : null}
      {files.error ? (
        <Banner
          tone="danger"
          icon="alert"
          actions={
            <Button size="sm" onClick={() => void files.refetch()}>
              다시 시도
            </Button>
          }
        >
          {files.error instanceof Error ? files.error.message : '녹음 목록을 불러오지 못했어요'}
        </Banner>
      ) : null}
      {files.data && rows.length === 0 ? <span className="text-sm text-ink-3">폴더에 녹음이 없어요. Drive 폴더에 녹음을 올린 뒤 다시 열어 주세요</span> : null}
      {rows.length > 0 ? (
        <ul role="radiogroup" aria-label="Drive 녹음" className="m-0 flex list-none flex-col divide-y divide-line rounded-md border border-line p-0">
          {rows.map((file) => {
            const problem = driveAudioProblem(file);
            return (
              <li key={file.id}>
                <label className={`flex items-center gap-3 px-3 py-2 text-sm ${problem ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-surface-2'}`}>
                  <input type="radio" name="drive-audio" checked={current === file.id} disabled={problem !== null} onChange={() => setChosen(file)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{file.name}</span>
                    {problem ? <span className="block text-cap text-danger">{problem}</span> : null}
                  </span>
                  <span className="flex-none text-xs text-ink-3 tabular-nums">{driveFileSizeLabel(file.size)}</span>
                  <span className="w-[120px] flex-none text-right text-xs text-ink-3 tabular-nums">{file.modifiedTime ? fmtDateTime(file.modifiedTime) : '-'}</span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
      {files.hasNextPage ? (
        <Button className="self-center" onClick={() => void files.fetchNextPage()} disabled={files.isFetchingNextPage}>
          {files.isFetchingNextPage ? '불러오는 중…' : '더 보기'}
        </Button>
      ) : null}
    </Modal>
  );
}
