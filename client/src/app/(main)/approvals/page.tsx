import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/approvals') };

export default function ApprovalPage() {
  return <StagePlaceholder stage={3} />;
}
