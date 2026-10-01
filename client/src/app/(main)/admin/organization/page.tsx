import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OrganizationScreen } from '@/features/admin/components/OrganizationScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/admin/organization') };

export default function OrganizationPage() {
  // 탭은 주소(?tab=, ?role=)로 열 수 있어 useSearchParams를 쓴다
  return (
    <Suspense>
      <OrganizationScreen />
    </Suspense>
  );
}
