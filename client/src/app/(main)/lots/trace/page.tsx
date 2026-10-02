import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StateView } from '@/components/StateView';
import { LotTraceScreen } from '@/features/lotTrace/components/LotTraceScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/lots/trace') };

export default function LotTracePage() {
  return (
    <Suspense fallback={<StateView kind="loading" />}>
      <LotTraceScreen />
    </Suspense>
  );
}
