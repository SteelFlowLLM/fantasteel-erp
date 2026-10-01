import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StateView } from '@/components/StateView';
import { pageTitle } from '@/features/shell/routeTitles';
import { GoodsIssueScreen } from '@/features/shipment/GoodsIssueScreen';

export const metadata: Metadata = { title: pageTitle('/goods-issues') };

export default function GoodsIssuePage() {
  return (
    <Suspense fallback={<StateView kind="loading" />}>
      <GoodsIssueScreen />
    </Suspense>
  );
}
