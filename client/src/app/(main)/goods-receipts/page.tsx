import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/goods-receipts') };

export default function GoodsReceiptPage() {
  return <StagePlaceholder stage={3} />;
}
