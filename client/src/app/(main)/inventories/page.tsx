import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/inventories') };

export default function InventoryPage() {
  return <StagePlaceholder stage={4} />;
}
