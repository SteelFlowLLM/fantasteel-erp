'use client';

// Drive 파일 /drive (문서에 없는 기능, 이슈 #392). 관리자가 연결한 회사 Google Drive 폴더의 사진·녹음·문서를 내려받지 않고 미리 보고, 필요하면 내려받는다.
// 읽기만 한다: 로그인한 사원 누구나 열 수 있고(서버가 같은 규칙), 폴더 설정은 관리자의 '외부 연결' 화면에서 한다.
import Link from 'next/link';
import { useState } from 'react';
import type { DriveFileView } from '@/api/integrations';
import { buttonClass } from '@/components/Button';
import { PageHead, PageMain } from '@/components/Page';
import { StateView } from '@/components/StateView';
import { DriveFileBrowser } from '@/features/drive/components/DriveFileBrowser';
import { DriveFilePreview } from '@/features/drive/components/DriveFilePreview';
import { useCanOpenHref } from '@/hooks/usePermission';
import { useDriveReady } from '@/hooks/useIntegrations';

export function DriveFilesScreen() {
  const drive = useDriveReady();
  const canOpenHref = useCanOpenHref();
  const [previewing, setPreviewing] = useState<DriveFileView | null>(null);

  return (
    <PageMain>
      <PageHead title="Drive 파일" />
      <span className="-mt-2 text-cap text-ink-3">회사 Google Drive 폴더에 올라온 사진·녹음·문서예요. 최근에 고친 것부터 보여요. 눌러서 미리 보고, 필요하면 내려받으세요</span>
      {drive.loading ? <StateView kind="loading" title="Drive 연결을 확인하는 중…" /> : null}
      {!drive.loading && !drive.ready ? (
        <StateView
          kind="empty"
          icon="link"
          title="Google Drive가 아직 연결되지 않았어요"
          text="관리자가 먼저 Google Drive를 연결하고 폴더를 정해야 해요"
          actions={
            canOpenHref('/admin/integrations') ? (
              <Link href="/admin/integrations" className={buttonClass({ size: 'sm' })}>
                외부 연결 열기
              </Link>
            ) : undefined
          }
        />
      ) : null}
      {drive.ready ? <DriveFileBrowser mode="open" onOpen={setPreviewing} /> : null}
      {previewing ? <DriveFilePreview file={previewing} onClose={() => setPreviewing(null)} /> : null}
    </PageMain>
  );
}
