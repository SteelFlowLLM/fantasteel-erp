'use client';

// Drive 파일 하나 고르기 창 (이슈 #361·#392). 회의록(녹음), 철강맨AI 입력(사진), 메신저 첨부(전체)가 같이 쓴다.
// 고른 뒤 무엇을 할지는 부르는 쪽이 정한다: 여기서는 파일 정보만 돌려준다.
import { useState } from 'react';
import type { DriveFileListKind, DriveFileView } from '@/api/integrations';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { DriveFileBrowser } from '@/features/drive/components/DriveFileBrowser';

export interface DriveFilePickerProps {
  title: string;
  /** 제목 아래 안내 */
  description?: string;
  /** 탭으로 보일 종류. 하나만 주면 그 종류만 보인다 */
  kinds: readonly DriveFileListKind[];
  selectedId?: string | null;
  /** 고를 수 없는 이유 (있으면 그 줄은 막힌다) */
  problemOf?: (file: DriveFileView) => string | null;
  confirmLabel: string;
  emptyText?: string;
  onPick: (file: DriveFileView) => void;
  onClose: () => void;
}

export function DriveFilePicker({ title, description, kinds, selectedId = null, problemOf, confirmLabel, emptyText, onPick, onClose }: DriveFilePickerProps) {
  const [chosen, setChosen] = useState<DriveFileView | null>(null);
  return (
    <Modal
      title={title}
      width={680}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" disabled={!chosen} onClick={() => chosen && onPick(chosen)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description ? <span className="text-cap text-ink-3">{description}</span> : null}
      <DriveFileBrowser mode="pick" kinds={kinds} selectedId={chosen?.id ?? selectedId} onSelect={setChosen} problemOf={problemOf} emptyText={emptyText} />
    </Modal>
  );
}
