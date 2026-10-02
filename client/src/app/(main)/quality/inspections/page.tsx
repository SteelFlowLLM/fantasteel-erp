import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StateView } from '@/components/StateView';
import { InspectionWorkspace } from '@/features/quality/components/InspectionWorkspace';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/quality/inspections') };

/** 검사 입력 (REQ-QC-001·003). 고른 LOT은 주소의 ?lot= 로 정한다. */
export default function InspectionPage() {
  return (
    <Suspense fallback={<StateView kind="loading" title="검사 대상 LOT을 불러오는 중…" />}>
      <InspectionWorkspace />
    </Suspense>
  );
}
