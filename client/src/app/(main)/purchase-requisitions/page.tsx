import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StateView } from '@/components/StateView';
import { RequisitionListScreen } from '@/features/purchasing/RequisitionListScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/purchase-requisitions') };

export default function PurchaseRequisitionListPage() {
  return (
    <Suspense fallback={<StateView kind="loading" />}>
      <RequisitionListScreen />
    </Suspense>
  );
}
