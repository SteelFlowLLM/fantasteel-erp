import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RollingScreen } from '@/features/production/RollingScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/production/rolling') };

export default function RollingAllocationPage() {
  return (
    <Suspense>
      <RollingScreen />
    </Suspense>
  );
}
