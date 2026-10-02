import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StateView } from '@/components/StateView';
import { PurchaseOrderScreen } from '@/features/purchasing/PurchaseOrderScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/purchase-orders') };

export default function PurchaseOrderPage() {
  return (
    <Suspense fallback={<StateView kind="loading" />}>
      <PurchaseOrderScreen />
    </Suspense>
  );
}
