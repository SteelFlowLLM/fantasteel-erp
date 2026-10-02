import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MessengerScreen } from '@/features/messenger/MessengerScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/messenger') };

export default function MessengerPage() {
  // 주소의 room을 읽으므로 Suspense로 감싼다 (Next.js useSearchParams)
  return (
    <Suspense fallback={null}>
      <MessengerScreen />
    </Suspense>
  );
}
