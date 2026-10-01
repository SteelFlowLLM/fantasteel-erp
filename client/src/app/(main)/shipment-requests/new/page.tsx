import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/shipment-requests/new') };

export default function ShipmentRequestCreatePage() {
  return <StagePlaceholder stage={5} />;
}
