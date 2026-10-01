import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/mill-sheets') };

export default function MillSheetPage() {
  return <StagePlaceholder stage={5} />;
}
