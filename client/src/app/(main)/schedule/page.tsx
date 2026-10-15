import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ScheduleScreen } from '@/features/schedule/ScheduleScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/schedule') };

export default function SchedulePage() {
  // 주소의 week를 읽으므로 Suspense로 감싼다 (Next.js useSearchParams)
  return (
    <Suspense fallback={null}>
      <ScheduleScreen />
    </Suspense>
  );
}
