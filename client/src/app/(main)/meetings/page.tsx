import type { Metadata } from 'next';
import { PageMain } from '@/components/Page';
import { MeetingScreen } from '@/features/meetings/MeetingScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/meetings') };

export default function MeetingPage() {
  return (
    <PageMain>
      <MeetingScreen />
    </PageMain>
  );
}
