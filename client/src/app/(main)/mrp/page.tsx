import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StateView } from '@/components/StateView';
import { MrpScreen } from '@/features/purchasing/MrpScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/mrp') };

export default function MrpPage() {
  return (
    <Suspense fallback={<StateView kind="loading" />}>
      <MrpScreen />
    </Suspense>
  );
}
