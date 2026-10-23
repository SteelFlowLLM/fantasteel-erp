import type { Metadata } from 'next';
import { OrgChartScreen } from '@/features/admin/components/OrgChartScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/org-chart') };

export default function OrgChartPage() {
  return <OrgChartScreen />;
}
