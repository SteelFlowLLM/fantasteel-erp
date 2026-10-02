import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StateView } from '@/components/StateView';
import { InventoryScreen } from '@/features/inventory/components/InventoryScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/inventories') };

export default function InventoryPage() {
  return (
    <Suspense fallback={<StateView kind="loading" title="재고를 불러오는 중…" />}>
      <InventoryScreen />
    </Suspense>
  );
}
