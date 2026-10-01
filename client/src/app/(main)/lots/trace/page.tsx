import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/lots/trace') };

export default function LotTracePage() {
  return <StagePlaceholder stage={5} />;
}
