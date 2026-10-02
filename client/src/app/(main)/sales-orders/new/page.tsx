import type { Metadata } from 'next';
import { SalesOrderCreateScreen } from '@/features/sales/SalesOrderCreateScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/sales-orders/new') };

export default function SalesOrderCreatePage() {
  return <SalesOrderCreateScreen />;
}
