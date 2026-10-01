import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/dashboard') };

export default function DashboardPage() {
  return <StagePlaceholder stage={6} />;
}
