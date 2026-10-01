import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/mrp') };

export default function MrpPage() {
  return <StagePlaceholder stage={3} />;
}
