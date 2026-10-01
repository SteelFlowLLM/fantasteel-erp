import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/sales-orders') };

export default function SalesOrderListPage() {
  return <StagePlaceholder stage={3} />;
}
