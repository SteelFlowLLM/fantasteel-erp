import type { Metadata } from 'next';
import { SalesOrderListScreen } from '@/features/sales/SalesOrderListScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/sales-orders') };

export default function SalesOrderListPage() {
  return <SalesOrderListScreen />;
}
