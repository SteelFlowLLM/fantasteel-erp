'use client';

// 기준정보 (REQ-MST-001~009, BP-MST-01). 위에 준비 상태 띠, 아래 영역별 탭(주소 ?tab=).
// 성분 규격은 강종 화면이 아니라 품질의 검사 기준(제강)에서 버전으로 관리한다 (REQ-MST-002, TRM-020).
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { isMasterServerMode } from '@/api/masterData';
import { PERMISSION } from '@/codes';
import { Icon, type IconName } from '@/components/Icon';
import { PageMain } from '@/components/Page';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { Tabs } from '@/components/Tabs';
import { ConsumptionTab } from '@/features/masterData/components/ConsumptionTab';
import { ItemTab } from '@/features/masterData/components/ItemTab';
import { isMasterTabKey, type MasterTabKey } from '@/features/masterData/components/MasterParts';
import { CustomerSupplierYardTab } from '@/features/masterData/components/CustomerSupplierYardTab';
import { ProductionSettingTab } from '@/features/masterData/components/ProductionSettingTab';
import { ProductSpecTab } from '@/features/masterData/components/ProductSpecTab';
import { ReadinessBanner } from '@/features/masterData/components/ReadinessBanner';
import { RoutingTab } from '@/features/masterData/components/RoutingTab';
import { SpecMappingTab } from '@/features/masterData/components/SpecMappingTab';
import { SteelGradeTab } from '@/features/masterData/components/SteelGradeTab';
import { useCanUse } from '@/hooks/usePermission';

const TABS: readonly { key: MasterTabKey; label: string; icon: IconName; sub: string }[] = [
  { key: 'specs', label: '제품 규격', icon: 'slab', sub: '슬래브·코일 규격과 1매 이론중량' },
  { key: 'mapping', label: '규격 매핑', icon: 'link', sub: '슬래브 규격 → 대응 코일 규격과 열연 계획 수율' },
  { key: 'grades', label: '강종', icon: 'check-circle', sub: '강종과 적용 규격 번호 · 성분 규격은 검사 기준(제강)에서 관리해요' },
  { key: 'routing', label: '라우팅', icon: 'flow', sub: '품목 유형별 공정 순서와 계획 수율' },
  { key: 'consumption', label: '배합 원단위', icon: 'calc', sub: '용선 1t당 원료, 용강 1t당 강종별 합금철 투입량' },
  { key: 'items', label: '품목', icon: 'box', sub: '원료 품목(원료 코드·원료 유형·기본 공급업체)과 제품 품목(슬래브·코일)' },
  { key: 'customer-supplier-yard', label: '고객사·공급업체·야드', icon: 'building', sub: '고객사·공급업체·야드 등록' },
  { key: 'settings', label: '생산 설정값', icon: 'gauge', sub: '히트 용량 · 납기 위험 기준일' },
];

export function MasterDataScreen() {
  const canEdit = useCanUse(PERMISSION.MASTER_MANAGE);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabParam = params.get('tab');
  const tab: MasterTabKey = isMasterTabKey(tabParam) ? tabParam : 'specs';
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];

  const goTab = useCallback(
    (key: MasterTabKey) => {
      router.replace(`${pathname}?tab=${key}`, { scroll: false });
    },
    [pathname, router],
  );

  return (
    <PageMain>
      <div className="flex flex-none items-end gap-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-2xl font-semibold text-ink">기준정보</h1>
          <span className="text-cap text-ink-3">{current.sub}</span>
        </div>
        {canEdit ? null : <ReadOnlyHint className="ml-auto" permissions={[PERMISSION.MASTER_MANAGE]} />}
      </div>
      {/* 준비 상태는 서버 API가 없어 서버 모드에서 숨긴다 */}
      {isMasterServerMode() ? null : <ReadinessBanner onGoTab={goTab} />}
      <Tabs
        ariaLabel="기준정보 영역"
        items={TABS.map((t) => ({
          key: t.key,
          label: (
            <>
              <Icon name={t.icon} size="sm" />
              {t.label}
            </>
          ),
        }))}
        active={tab}
        onChange={goTab}
      />
      <div className="flex min-h-0 flex-col gap-4">
        {tab === 'specs' ? <ProductSpecTab canEdit={canEdit} onGoTab={goTab} /> : null}
        {tab === 'mapping' ? <SpecMappingTab canEdit={canEdit} /> : null}
        {tab === 'grades' ? <SteelGradeTab canEdit={canEdit} /> : null}
        {tab === 'routing' ? <RoutingTab canEdit={canEdit} onGoTab={goTab} /> : null}
        {tab === 'consumption' ? <ConsumptionTab canEdit={canEdit} /> : null}
        {tab === 'items' ? <ItemTab canEdit={canEdit} onGoTab={goTab} /> : null}
        {tab === 'customer-supplier-yard' ? <CustomerSupplierYardTab canEdit={canEdit} /> : null}
        {tab === 'settings' ? <ProductionSettingTab canEdit={canEdit} /> : null}
      </div>
    </PageMain>
  );
}
