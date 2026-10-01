import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProductionResultScreen } from '@/features/production/ProductionResultScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/production/results') };

export default function ProductionResultPage() {
  return (
    <Suspense>
      <ProductionResultScreen />
    </Suspense>
  );
}
