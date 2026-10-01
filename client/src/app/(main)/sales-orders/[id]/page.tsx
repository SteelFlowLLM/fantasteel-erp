import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/sales-orders/[id]') };

export default function SalesOrderDetailPage() {
  return <StagePlaceholder stage={3} />;
}
