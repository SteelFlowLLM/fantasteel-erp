import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/action-drafts/[id]') };

export default function ActionDraftPage() {
  return <StagePlaceholder stage={3} />;
}
