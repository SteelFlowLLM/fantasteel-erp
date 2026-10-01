import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/quality/inspections') };

export default function InspectionPage() {
  return <StagePlaceholder stage={4} />;
}
