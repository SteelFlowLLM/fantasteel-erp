import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/goods-issues') };

export default function GoodsIssuePage() {
  return <StagePlaceholder stage={5} />;
}
