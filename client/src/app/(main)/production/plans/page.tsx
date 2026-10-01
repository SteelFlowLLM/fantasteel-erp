import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/production/plans') };

export default function ProductionPlanPage() {
  return <StagePlaceholder stage={3} />;
}
