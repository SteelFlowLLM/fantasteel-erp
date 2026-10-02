import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StateView } from '@/components/StateView';
import { pageTitle } from '@/features/shell/routeTitles';
import { ShipmentRequestListScreen } from '@/features/shipment/ShipmentRequestListScreen';

export const metadata: Metadata = { title: pageTitle('/shipment-requests') };

export default function ShipmentRequestListPage() {
  return (
    <Suspense fallback={<StateView kind="loading" />}>
      <ShipmentRequestListScreen />
    </Suspense>
  );
}
