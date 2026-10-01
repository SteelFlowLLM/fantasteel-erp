import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/shipment-requests/[id]') };

export default function ShipmentRequestDetailPage() {
  return <StagePlaceholder stage={5} />;
}
