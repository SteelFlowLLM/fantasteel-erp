import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StateView } from '@/components/StateView';
import { BusinessEventScreen } from '@/features/businessEvents/components/BusinessEventScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/business-events') };

export default function BusinessEventPage() {
  return (
    <Suspense fallback={<StateView kind="loading" />}>
      <BusinessEventScreen />
    </Suspense>
  );
}
