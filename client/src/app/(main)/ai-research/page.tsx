import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AiResearchScreen } from '@/features/ai-research/AiResearchScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/ai-research') };

export default function AiResearchPage() {
  // 주소의 id를 읽으므로 Suspense로 감싼다 (Next.js useSearchParams)
  return (
    <Suspense fallback={null}>
      <AiResearchScreen />
    </Suspense>
  );
}
