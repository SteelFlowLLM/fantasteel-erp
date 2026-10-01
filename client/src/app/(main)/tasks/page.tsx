import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/tasks') };

export default function TaskNotificationPage() {
  return <StagePlaceholder stage={2} />;
}
