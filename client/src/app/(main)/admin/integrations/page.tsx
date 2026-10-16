import type { Metadata } from 'next';
import { Suspense } from 'react';
import { IntegrationsScreen } from '@/features/admin/components/IntegrationsScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/admin/integrations') };

export default function IntegrationsPage() {
  // 연결 허용이 끝나고 돌아올 때의 결과를 주소 쿼리에서 읽으므로 Suspense로 감싼다 (Next.js useSearchParams)
  return (
    <Suspense>
      <IntegrationsScreen />
    </Suspense>
  );
}
