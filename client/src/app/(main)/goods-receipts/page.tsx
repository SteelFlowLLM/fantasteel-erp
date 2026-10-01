import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StateView } from '@/components/StateView';
import { GoodsReceiptScreen } from '@/features/purchasing/GoodsReceiptScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/goods-receipts') };

export default function GoodsReceiptPage() {
  return (
    <Suspense fallback={<StateView kind="loading" />}>
      <GoodsReceiptScreen />
    </Suspense>
  );
}
