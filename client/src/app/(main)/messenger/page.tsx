import type { Metadata } from 'next';
import { StagePlaceholder } from '@/components/StagePlaceholder';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/messenger') };

export default function MessengerPage() {
  return <StagePlaceholder stage={2} />;
}
