import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/agent') };

export default function AgentPage() {
  return <StagePlaceholder stage={6} soon={{ grade: 'P2', title: 'AI Factory Agent' }} />;
}
