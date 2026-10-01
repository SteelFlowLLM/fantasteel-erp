import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/business-events') };

export default function BusinessEventPage() {
  return <StagePlaceholder stage={5} />;
}
