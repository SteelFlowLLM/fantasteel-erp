import type { Metadata } from 'next';
import { PageMain } from '@/components/Page';
import { PastCaseScreen } from '@/features/pastCases/PastCaseScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/past-cases') };

export default function PastCasePage() {
  return (
    <PageMain>
      <PastCaseScreen />
    </PageMain>
  );
}
