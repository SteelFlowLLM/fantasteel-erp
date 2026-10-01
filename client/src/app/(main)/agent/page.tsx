import type { Metadata } from 'next';
import { PageMain } from '@/components/Page';
import { AgentScreen } from '@/features/agent/AgentScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/agent') };

export default function AgentPage() {
  return (
    <PageMain>
      <AgentScreen />
    </PageMain>
  );
}
