import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StateView } from '@/components/StateView';
import { pageTitle } from '@/features/shell/routeTitles';
import { MillSheetScreen } from '@/features/millSheets/MillSheetScreen';

export const metadata: Metadata = { title: pageTitle('/mill-sheets') };

export default function MillSheetPage() {
  return (
    <Suspense fallback={<StateView kind="loading" />}>
      <MillSheetScreen />
    </Suspense>
  );
}
