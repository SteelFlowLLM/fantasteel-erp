'use client';

// Drive 파일 미리보기 창 (이슈 #392). 사진·PDF는 서버에서 받은 Blob을 이 화면의 주소(blob:)로 보이고, 녹음은 서버 주소를 <audio>가 이어 받으며 재생한다.
// PDF를 Blob으로 보이는 까닭: 서버는 받은 내용이 스크립트로 돌지 않게 sandbox CSP를 붙이는데, 이것이 Chrome의 PDF 뷰어를 막는다.
// Blob은 형식을 application/pdf로 고정해 만들므로 서버가 다른 내용을 보내도 HTML로 열리지 않는다.
import { useEffect, useState } from 'react';
import { integrationApi, type DriveFileView } from '@/api/integrations';
import { Banner } from '@/components/Banner';
import { Button, buttonClass } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/StateView';
import { useDriveFileBlob } from '@/hooks/useIntegrations';
import { driveDeliveredName, drivePreviewType, driveKindLabel, driveSizeText } from '@/lib/driveFiles';

/** Blob을 정한 형식으로 다시 감싼 주소. 창이 닫히면 거둔다 */
function useBlobUrl(blob: Blob | undefined, type: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const next = URL.createObjectURL(new Blob([blob], { type }));
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
      setUrl(null);
    };
  }, [blob, type]);
  return url;
}

function BlobPreview({ file, type }: { file: DriveFileView; type: 'image' | 'pdf' }) {
  const blob = useDriveFileBlob(file.id);
  const url = useBlobUrl(blob.data, type === 'pdf' ? 'application/pdf' : file.mimeType);
  if (blob.error) {
    return (
      <Banner tone="danger" icon="alert" actions={<Button size="sm" onClick={() => void blob.refetch()}>다시 시도</Button>}>
        {blob.error instanceof Error ? blob.error.message : '파일을 불러오지 못했어요'}
      </Banner>
    );
  }
  if (!url) return <Spinner label="파일을 불러오는 중…" className="self-center py-10" />;
  if (type === 'image') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={file.name} className="mx-auto max-h-[65vh] max-w-full rounded-sm border border-line object-contain" />;
  }
  return <iframe title={`${file.name} 미리보기`} src={url} className="h-[68vh] w-full rounded-sm border border-line bg-surface-2" />;
}

function AudioPreview({ file }: { file: DriveFileView }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <audio controls preload="metadata" src={integrationApi.driveContentUrl(file.id)} className="w-full" onError={() => setFailed(true)} />
      {failed ? <Banner tone="wait">이 녹음을 재생하지 못했어요. 형식을 브라우저가 지원하지 않을 수 있어요. 내려받아 들어 주세요</Banner> : null}
    </div>
  );
}

export function DriveFilePreview({ file, onClose }: { file: DriveFileView; onClose: () => void }) {
  const preview = drivePreviewType(file);
  return (
    <Modal
      title={<span className="block max-w-[calc(100vw-160px)] truncate sm:max-w-[760px]">{driveDeliveredName(file)}</span>}
      width={880}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <a href={integrationApi.driveContentUrl(file.id, { download: true })} download rel="noopener" className={buttonClass({ variant: 'primary' })}>
            내려받기
          </a>
        </>
      }
    >
      <span className="text-cap text-ink-3">
        {driveKindLabel(file)} · {driveSizeText(file)}
        {file.mimeType.startsWith('application/vnd.google-apps.') ? ' · Google 문서는 PDF로 바꿔 보여요' : ''}
      </span>
      {preview === 'image' || preview === 'pdf' ? <BlobPreview file={file} type={preview} /> : null}
      {preview === 'audio' ? <AudioPreview file={file} /> : null}
      {preview === null ? <Banner tone="neutral">이 형식은 브라우저에서 바로 볼 수 없어요. 내려받아 열어 주세요</Banner> : null}
    </Modal>
  );
}
