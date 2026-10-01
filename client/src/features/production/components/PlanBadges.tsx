// 생산 화면 배지: 계획 상태 · 재생산 · 완료 후 여재 · LOT 품질 · 제품 유형
import {
  ALLOCATION_PURPOSE_LABEL,
  ALLOCATION_STATUS_LABEL,
  DISPOSITION_STATUS_LABEL,
  INSPECTION_RESULT_LABEL, ITEM_TYPE_LABEL, LOT_STATUS_LABEL, PRODUCTION_PLAN_STATUS_LABEL, type ProductItemType, type ProductionPlanStatus } from '@/codes';
import type { LotQuality, PlanLotRow } from '@/api/production';
import { Badge } from '@/components/Badge';
import { Tag } from '@/components/Tag';
import { PLAN_STATUS_TONE } from '@/features/production/lib/productionDisplay';

export function PlanStatusBadge({ status }: { status: ProductionPlanStatus }) {
  return <Badge tone={PLAN_STATUS_TONE[status]}>{PRODUCTION_PLAN_STATUS_LABEL[status]}</Badge>;
}

/** 재생산 계획(is_reproduction)과 완료 후 여재(is_surplus_on_completion) 표시 */
export function PlanFlags({ isReproduction, isSurplusOnCompletion }: { isReproduction: boolean; isSurplusOnCompletion: boolean }) {
  return (
    <>
      {isReproduction ? (
        <Badge tone="wait" plain title="품질 불합격 등으로 모자란 매수를 다시 만드는 계획이에요">
          재생산
        </Badge>
      ) : null}
      {isSurplusOnCompletion ? (
        <Badge tone="outline" title="수주 취소로 연결이 끊겨, 이 계획에서 나오는 슬래브는 여재로 남아요">
          완료 후 여재
        </Badge>
      ) : null}
    </>
  );
}

export function ProductTypeTag({ itemType }: { itemType: ProductItemType }) {
  return <Tag>{ITEM_TYPE_LABEL[itemType]}</Tag>;
}

/** LOT 품질: 자기 판정 + 상위 히트 성분 판정 */
export function LotQualityBadge({ quality }: { quality: LotQuality }) {
  switch (quality) {
    case 'NONE':
      return <span className="text-cap text-ink-3">검사 없음</span>;
    case 'PASS':
      return <Badge tone="ok">{INSPECTION_RESULT_LABEL.PASS}</Badge>;
    case 'FAIL':
      return <Badge tone="danger">{INSPECTION_RESULT_LABEL.FAIL}</Badge>;
    case 'HEAT_FAILED':
      return (
        <Badge tone="danger" title="상위 히트의 성분 검사가 불합격이라 적격에서 빠졌어요">
          히트 {INSPECTION_RESULT_LABEL.FAIL}
        </Badge>
      );
    case 'HEAT_PENDING':
      return (
        <Badge tone="wait" title="자기 검사는 합격했지만 상위 히트의 성분 판정이 아직이에요">
          히트 {INSPECTION_RESULT_LABEL.PENDING}
        </Badge>
      );
    default:
      return <Badge tone="wait">{INSPECTION_RESULT_LABEL.PENDING}</Badge>;
  }
}

/** LOT 상태 글자: 처리 상태 → 투입 소진·출고 → 배정 확정(목적) → 여재(미배정 '합격' 슬래브, REQ-INV-008) → 재고 */
export function lotStateText(lot: Pick<PlanLotRow, 'dispositionStatus' | 'lotStatus' | 'allocationPurpose' | 'surplusAt' | 'lotType' | 'quality'>): string {
  if (lot.dispositionStatus) return DISPOSITION_STATUS_LABEL[lot.dispositionStatus];
  if (lot.lotStatus !== 'AVAILABLE') return LOT_STATUS_LABEL[lot.lotStatus];
  if (lot.allocationPurpose) return `${ALLOCATION_STATUS_LABEL.CONFIRMED} · ${ALLOCATION_PURPOSE_LABEL[lot.allocationPurpose]}`;
  if (lot.lotType === 'SLAB' && lot.surplusAt && lot.quality === 'PASS') return '여재';
  return LOT_STATUS_LABEL.AVAILABLE;
}
