import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/admin/organization') };

export default function OrganizationPage() {
  return <StagePlaceholder stage={2} />;
}
