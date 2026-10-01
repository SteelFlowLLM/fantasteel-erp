import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StateView } from '@/components/StateView';
import { RejectedLotWorkspace } from '@/features/quality/components/RejectedLotWorkspace';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/quality/rejected') };

/** 불합격 관리 (REQ-QC-004). 고른 LOT은 주소의 ?lot= 로 정한다. */
export default function RejectedLotPage() {
  return (
    <Suspense fallback={<StateView kind="loading" title="불합격 LOT을 불러오는 중…" />}>
      <RejectedLotWorkspace />
    </Suspense>
  );
}
