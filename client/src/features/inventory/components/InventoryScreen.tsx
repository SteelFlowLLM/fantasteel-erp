// 재고 (REQ-INV-001·003·007·008, 업무 프로세스 4.2·4.3, PLAN 7장 재고). 조회 전용 — 로그인한 모든 사원이 본다.
// 탭: 제품(규격별) · LOT 목록 · 원료 · 여재. 정합성 보정(REQ-INV-010): 점검은 모두, 보정은 관리자 (ReconciliationModal).
'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { PageMain } from '@/components/Page';
import { Tabs } from '@/components/Tabs';
import { LotListTab } from '@/features/inventory/components/LotListTab';
import { ProductInventoryTab } from '@/features/inventory/components/ProductInventoryTab';
import { RawMaterialTab } from '@/features/inventory/components/RawMaterialTab';
import { ReconciliationModal } from '@/features/inventory/components/ReconciliationModal';
import { SurplusTab } from '@/features/inventory/components/SurplusTab';
import { useInventoryParams, type InventoryTab } from '@/features/inventory/useInventoryParams';

const TAB_ITEMS: readonly { key: InventoryTab; label: ReactNode }[] = [
  { key: 'products', label: <span data-pet-term="제품">제품</span> },
  { key: 'lots', label: <span data-pet-term="LOT 목록">LOT 목록</span> },
  { key: 'raw', label: <span data-pet-term="원료">원료</span> },
  { key: 'surplus', label: <span data-pet-term="여재">여재</span> },
];

export function InventoryScreen() {
  const [params, update] = useInventoryParams();
  const [reconciling, setReconciling] = useState(false);
  return (
    <PageMain className="gap-3 px-5 py-4">
      {/* self-start: 줄 너비를 탭·버튼만큼으로 줄여 펫 강조 테두리가 오른쪽 빈 곳까지 늘어나지 않게 한다 */}
      <div data-pet-target="card:inventories.tabs" className="flex flex-none items-end gap-3 self-start">
        <Tabs ariaLabel="재고 구분" items={TAB_ITEMS} active={params.tab} onChange={(tab) => update({ tab })} className="flex-1" />
        <span data-pet-term="조회 전용" className="pb-2.5 text-cap text-ink-3">
          조회 전용 · 예약·출고·검사·작업 실적이 반영되면 바로 바뀌어요
        </span>
        <Button size="sm" className="mb-1.5" data-pet-term="정합성 보정" onClick={() => setReconciling(true)}>
          정합성 보정
        </Button>
      </div>
      {reconciling ? <ReconciliationModal onClose={() => setReconciling(false)} /> : null}
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
