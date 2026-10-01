import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/quality/standards') };

export default function InspectionStandardPage() {
  return <StagePlaceholder stage={2} />;
}
