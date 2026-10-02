import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageMain } from '@/components/Page';
import { StateView } from '@/components/StateView';
import { MasterDataScreen } from '@/features/masterData/components/MasterDataScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/admin/master-data') };

export default function MasterDataPage() {
  return (
    <Suspense
      fallback={
        <PageMain>
          <StateView kind="loading" />
        </PageMain>
      }
    >
      <MasterDataScreen />
    </Suspense>
  );
}
