'use client';

// 조직도 (REQ-ORG-003): 모든 사원이 보는 조회 전용 화면 (역할별 메뉴 v2 "공통 · 조직도"). 부서·부서장 변경은 관리자의 "부서·직급·권한"에서 한다.
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { PageHead, PageMain } from '@/components/Page';
import { OrgChartTab } from '@/features/admin/components/OrgChartTab';

export function OrgChartScreen() {
  return (
    <PageMain className="gap-3">
      <PageHead
        crumb={
          <>
            <Link href="/dashboard" className="text-ink-3 hover:underline">
              대시보드
            </Link>
            <Icon name="chevron-right" size="sm" />
            조직도
          </>
        }
        title="조직도"
      />
      <OrgChartTab />
    </PageMain>
  );
}
