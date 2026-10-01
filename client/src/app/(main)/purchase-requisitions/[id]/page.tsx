import type { Metadata } from 'next';
import { RequisitionDetailScreen } from '@/features/purchasing/RequisitionDetailScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/purchase-requisitions/[id]') };

export default async function PurchaseRequisitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RequisitionDetailScreen idText={id} />;
}
