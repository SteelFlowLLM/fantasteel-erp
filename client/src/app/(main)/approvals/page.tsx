import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StateView } from '@/components/StateView';
import { ApprovalScreen } from '@/features/purchasing/ApprovalScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/approvals') };

export default function ApprovalPage() {
  return (
    <Suspense fallback={<StateView kind="loading" />}>
      <ApprovalScreen />
    </Suspense>
  );
}
