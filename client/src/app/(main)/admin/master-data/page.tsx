import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/admin/master-data') };

export default function MasterDataPage() {
  return <StagePlaceholder stage={2} />;
}
