import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageMain } from '@/components/Page';
import { StateView } from '@/components/StateView';
import { PastCaseScreen } from '@/features/pastCases/PastCaseScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/past-cases') };

/** 과거 사례 검색 (REQ-CASE-003). 품질 화면의 '비슷한 사례 찾기'는 검색어를 주소의 ?q= 로 넘긴다. */
export default function PastCasePage() {
  return (
    <PageMain>
      <Suspense fallback={<StateView kind="loading" title="과거 사례를 불러오는 중…" />}>
        <PastCaseScreen />
      </Suspense>
    </PageMain>
  );
}
