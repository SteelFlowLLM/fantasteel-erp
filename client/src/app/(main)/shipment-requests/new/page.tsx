import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StateView } from '@/components/StateView';
import { pageTitle } from '@/features/shell/routeTitles';
import { ShipmentRequestCreateScreen } from '@/features/shipment/ShipmentRequestCreateScreen';

export const metadata: Metadata = { title: pageTitle('/shipment-requests/new') };

export default function ShipmentRequestCreatePage() {
  return (
    <Suspense fallback={<StateView kind="loading" />}>
      <ShipmentRequestCreateScreen />
    </Suspense>
  );
}
