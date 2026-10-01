import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageMain } from '@/components/Page';
import { StateView } from '@/components/StateView';
import { InspectionStandardScreen } from '@/features/inspectionStandards/components/InspectionStandardScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/quality/standards') };

export default function InspectionStandardPage() {
  return (
    <Suspense
      fallback={
        <PageMain>
          <StateView kind="loading" />
        </PageMain>
      }
    >
      <InspectionStandardScreen />
    </Suspense>
  );
}
