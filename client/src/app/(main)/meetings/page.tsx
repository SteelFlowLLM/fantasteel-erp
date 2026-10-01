import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/meetings') };

export default function MeetingPage() {
  return <StagePlaceholder stage={6} soon={{ grade: 'P2', title: 'Voice2ERP 회의록' }} />;
}
