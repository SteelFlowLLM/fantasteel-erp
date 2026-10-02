// 재고 (REQ-INV-001·003·007·008, 업무 프로세스 4.2·4.3, PLAN 7장 재고). 조회 전용 — 로그인한 모든 사원이 본다.
// 탭: 제품(규격별) · LOT 목록 · 원료 · 여재. 정합성 보정(REQ-INV-010)은 P2라 '준비 중'.
'use client';

import { SoonButton } from '@/components/ComingSoon';
import { PageMain } from '@/components/Page';
import { Tabs } from '@/components/Tabs';
import { LotListTab } from '@/features/inventory/components/LotListTab';
import { ProductInventoryTab } from '@/features/inventory/components/ProductInventoryTab';
import { RawMaterialTab } from '@/features/inventory/components/RawMaterialTab';
import { SurplusTab } from '@/features/inventory/components/SurplusTab';
import { useInventoryParams, type InventoryTab } from '@/features/inventory/useInventoryParams';

const TAB_ITEMS: readonly { key: InventoryTab; label: string }[] = [
  { key: 'products', label: '제품' },
  { key: 'lots', label: 'LOT 목록' },
  { key: 'raw', label: '원료' },
  { key: 'surplus', label: '여재' },
];

export function InventoryScreen() {
  const [params, update] = useInventoryParams();
  return (
    <PageMain className="gap-3 px-5 py-4">
      <div className="flex flex-none items-end gap-3">
        <Tabs ariaLabel="재고 구분" items={TAB_ITEMS} active={params.tab} onChange={(tab) => update({ tab })} className="flex-1" />
        <span className="pb-2.5 text-cap text-ink-3">조회 전용 · 예약·출고·검사·작업 실적이 반영되면 바로 바뀌어요</span>
        <SoonButton size="sm" className="mb-1.5">
          정합성 보정
        </SoonButton>
      </div>
      {params.tab === 'products' ? (
        <ProductInventoryTab
          itemType={params.itemType}
          steelGrade={params.steelGrade}
          onItemTypeChange={(itemType) => update({ itemType })}
          onSteelGradeChange={(steelGrade) => update({ steelGrade })}
        />
      ) : params.tab === 'lots' ? (
        <LotListTab
          lotType={params.lotType}
          lotStatus={params.lotStatus}
          onLotTypeChange={(lotType) => update({ lotType })}
          onLotStatusChange={(lotStatus) => update({ lotStatus })}
        />
      ) : params.tab === 'raw' ? (
        <RawMaterialTab />
      ) : (
        <SurplusTab steelGrade={params.steelGrade} onSteelGradeChange={(steelGrade) => update({ steelGrade })} />
      )}
    </PageMain>
  );
}
