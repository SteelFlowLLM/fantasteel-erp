import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProductionPlanScreen } from '@/features/production/ProductionPlanScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/production/plans') };

export default function ProductionPlanPage() {
  return (
    <Suspense>
      <ProductionPlanScreen />
    </Suspense>
  );
}
