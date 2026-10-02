import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StateView } from '@/components/StateView';
import { pageTitle } from '@/features/shell/routeTitles';
import { ShipmentRequestDetailScreen } from '@/features/shipment/ShipmentRequestDetailScreen';

export const metadata: Metadata = { title: pageTitle('/shipment-requests/[id]') };

export default async function ShipmentRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<StateView kind="loading" />}>
      <ShipmentRequestDetailScreen id={Number(id)} />
    </Suspense>
  );
}
