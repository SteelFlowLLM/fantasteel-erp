import type { Metadata } from 'next';
import { SalesOrderDetailScreen } from '@/features/sales/SalesOrderDetailScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/sales-orders/[id]') };

export default function SalesOrderDetailPage() {
  return <SalesOrderDetailScreen />;
}
