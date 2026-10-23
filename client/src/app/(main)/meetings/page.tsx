import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MeetingScreen } from '@/features/meetings/MeetingScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/meetings') };

export default function MeetingPage() {
  // 주소의 id·new를 읽으므로 Suspense로 감싼다 (Next.js useSearchParams)
  return (
    <Suspense fallback={null}>
      <MeetingScreen />
    </Suspense>
  );
}
