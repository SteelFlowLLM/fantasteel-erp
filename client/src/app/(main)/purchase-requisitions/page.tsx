import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/purchase-requisitions') };

export default function PurchaseRequisitionListPage() {
  return <StagePlaceholder stage={3} />;
}
