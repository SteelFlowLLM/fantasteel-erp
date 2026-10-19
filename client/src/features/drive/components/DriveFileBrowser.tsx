'use client';

// Drive 폴더의 파일 목록: 종류 탭(전체·사진·녹음·문서), 최신 수정순, 더 보기 (이슈 #361·#392).
// Drive 파일 화면(열어 보기)과 고르는 창(DriveFilePicker)이 같이 쓴다.
import { useState } from 'react';
import type { DriveFileListKind, DriveFileView } from '@/api/integrations';
import { integrationApi } from '@/api/integrations';
import { Banner } from '@/components/Banner';
import { Button, buttonClass } from '@/components/Button';
import { Tabs } from '@/components/Tabs';
import { DriveFileThumb } from '@/features/drive/components/DriveFileThumb';
import { useDriveFiles } from '@/hooks/useIntegrations';
import { cn } from '@/lib/cn';
import { DRIVE_KIND_LABEL, DRIVE_KIND_TAB_ORDER, driveKindLabel, driveSizeText } from '@/lib/driveFiles';
import { fmtDateTime } from '@/lib/format';

export interface DriveFileBrowserProps {
  /** 탭으로 보일 종류. 하나뿐이면 탭을 그리지 않는다 (기본: 전체·사진·녹음·문서) */
  kinds?: readonly DriveFileListKind[];
  /** open: 줄을 누르면 열어 보고 내려받기 링크가 붙는다. pick: 줄 하나를 고른다 */
  mode: 'open' | 'pick';
  onOpen?: (file: DriveFileView) => void;
  /** pick: 지금 골라 둔 파일 id */
  selectedId?: string | null;
  onSelect?: (file: DriveFileView) => void;
  /** pick: 고를 수 없는 이유 (있으면 줄이 막힌다) */
  problemOf?: (file: DriveFileView) => string | null;
  /** 목록이 비었을 때 안내 */
  emptyText?: string;
}

export function DriveFileBrowser({ kinds = DRIVE_KIND_TAB_ORDER, mode, onOpen, selectedId = null, onSelect, problemOf, emptyText }: DriveFileBrowserProps) {
  const [kind, setKind] = useState<DriveFileListKind>(kinds[0] ?? 'all');
  const files = useDriveFiles(kind, true);
  const rows = files.data?.pages.flatMap((page) => page.files) ?? [];

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {kinds.length > 1 ? <Tabs ariaLabel="파일 종류" items={kinds.map((key) => ({ key, label: DRIVE_KIND_LABEL[key] }))} active={kind} onChange={setKind} /> : null}
      {files.isPending ? <span className="text-sm text-ink-3">파일 목록을 불러오는 중…</span> : null}
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
          {files.error instanceof Error ? files.error.message : '파일 목록을 불러오지 못했어요'}
        </Banner>
      ) : null}
      {files.data && rows.length === 0 ? <span className="text-sm text-ink-3">{emptyText ?? `폴더에 ${kind === 'all' ? '파일' : DRIVE_KIND_LABEL[kind]}이 없어요. Drive 폴더에 올린 뒤 다시 열어 주세요`}</span> : null}
      {rows.length > 0 ? (
        <ul role={mode === 'pick' ? 'radiogroup' : undefined} aria-label="Drive 파일" className="m-0 flex list-none flex-col divide-y divide-line rounded-md border border-line p-0">
          {rows.map((file) => {
            const problem = problemOf?.(file) ?? null;
            const info = (
              <>
                <DriveFileThumb file={file} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{file.name}</span>
                  <span className="block text-cap text-ink-3">{problem ? <span className="text-danger">{problem}</span> : driveKindLabel(file)}</span>
                </span>
                <span className="w-[72px] flex-none text-right text-xs text-ink-3 tabular-nums">{driveSizeText(file)}</span>
                <span className="w-[120px] flex-none text-right text-xs text-ink-3 tabular-nums">{file.modifiedTime ? fmtDateTime(file.modifiedTime) : '-'}</span>
              </>
            );
            if (mode === 'pick') {
              return (
                <li key={file.id}>
                  <label className={cn('flex items-center gap-3 px-3 py-2 text-sm', problem ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-surface-2')}>
                    <input type="radio" name="drive-file" checked={selectedId === file.id} disabled={problem !== null} onChange={() => onSelect?.(file)} />
                    {info}
                  </label>
                </li>
              );
            }
            return (
              <li key={file.id} className="flex items-center gap-2 pr-3 hover:bg-surface-2">
                <button type="button" onClick={() => onOpen?.(file)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left text-sm">
                  {info}
                </button>
                <a
                  href={integrationApi.driveContentUrl(file.id, { download: true })}
                  download
                  rel="noopener"
                  aria-label={`${file.name} 내려받기`}
                  className={buttonClass({ size: 'sm' })}
                >
                  내려받기
                </a>
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
    </div>
  );
}
