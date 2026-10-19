'use client';

// Drive 파일 한 개의 작은 그림: 사진은 Drive가 준 미리보기(몇 시간 뒤 만료), 없거나 불러오지 못하면 종류 아이콘 (이슈 #392)
import { useState } from 'react';
import type { DriveFileView } from '@/api/integrations';
import { Icon, type IconName } from '@/components/Icon';

const KIND_ICON: Record<DriveFileView['kind'], IconName> = { image: 'grid', audio: 'mic', document: 'file' };

export function DriveFileThumb({ file }: { file: Pick<DriveFileView, 'kind' | 'thumbnailLink'> }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex size-10 flex-none items-center justify-center overflow-hidden rounded-sm border border-line bg-surface-2 text-ink-3">
      {file.thumbnailLink && !failed ? (
        // 만료되면 아이콘으로 바꾼다. 주소의 출처(Google)에 이 화면 주소를 알리지 않는다
        // eslint-disable-next-line @next/next/no-img-element
        <img src={file.thumbnailLink} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <Icon name={KIND_ICON[file.kind]} size="lg" />
      )}
    </span>
  );
}
