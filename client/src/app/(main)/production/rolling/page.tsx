import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/production/rolling') };

export default function HotRollingAllocationPage() {
  return <StagePlaceholder stage={4} />;
}
