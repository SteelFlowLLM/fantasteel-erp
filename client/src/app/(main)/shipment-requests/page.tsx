import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/shipment-requests') };

export default function ShipmentRequestListPage() {
  return <StagePlaceholder stage={5} />;
}
