import type { Metadata } from 'next';
import { ActionDraftScreen } from '@/features/actionDrafts/ActionDraftScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/action-drafts/[id]') };

export default function ActionDraftPage() {
  return <ActionDraftScreen />;
}
