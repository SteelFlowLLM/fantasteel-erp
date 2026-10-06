// 구매 화면 공통 조각: 상태 배지(공통 코드 표시명), 출처 꼬리표, 목록 항목, 목록 묶음 제목
import type { ReactNode } from 'react';
import {
  PRODUCTION_PLAN_STATUS_LABEL,
  PURCHASE_ORDER_STATUS_LABEL,
  PURCHASE_REQUISITION_STATUS_LABEL,
  type ProductionPlanStatus,
  type PurchaseOrderStatus,
  type PurchaseRequisitionStatus,
} from '@/codes';
import type { RequisitionSource } from '@/api/purchasing';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Tag } from '@/components/Tag';
import { REQUISITION_SOURCE_LABEL } from '@/features/purchasing/lib/purchasingView';
import { cn } from '@/lib/cn';
import { PRODUCTION_PLAN_STATUS_TONE, PURCHASE_REQUISITION_STATUS_TONE } from '@/lib/statusTone';

const PURCHASE_ORDER_TONE: Record<PurchaseOrderStatus, BadgeTone> = {
  CONFIRMED: 'run',
  PARTIALLY_RECEIVED: 'wait',
  RECEIVED: 'ok',
};

export function RequisitionStatusBadge({ status }: { status: PurchaseRequisitionStatus }) {
  return <Badge tone={PURCHASE_REQUISITION_STATUS_TONE[status]}>{PURCHASE_REQUISITION_STATUS_LABEL[status]}</Badge>;
}

export function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <Badge tone={PURCHASE_ORDER_TONE[status]}>{PURCHASE_ORDER_STATUS_LABEL[status]}</Badge>;
}

export function PlanStatusBadge({ status }: { status: ProductionPlanStatus }) {
  return <Badge tone={PRODUCTION_PLAN_STATUS_TONE[status]}>{PRODUCTION_PLAN_STATUS_LABEL[status]}</Badge>;
}

/** 출처(계산값) 꼬리표 */
export function RequisitionSourceTag({ source }: { source: RequisitionSource }) {
  return (
    <Tag tone={source === 'DIRECT' ? 'outline' : source === 'MESSAGE' ? 'run' : 'neutral'} size="sm" title="출처 (요청에 연결된 생산계획·초안으로 계산)">
      {REQUISITION_SOURCE_LABEL[source]}
    </Tag>
  );
}

/** 목록 칸의 항목 (선택하면 왼쪽 막대 + 옅은 바탕) */
export function MasterItem({
  selected,
  onClick,
  onDoubleClick,
  title,
  label,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  title?: string;
  /** 단추 이름 (화면 낭독기용). 안의 글자가 여러 칸으로 나뉘어 있으면 한 줄 요약을 준다 */
  label?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      title={title}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        'flex w-full flex-col gap-1 border-b border-line px-4 py-2.5 text-left text-sm hover:bg-surface-2',
        selected && 'bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)] hover:bg-brand-tint-hover',
      )}
    >
      {children}
    </button>
  );
}

/** 목록 칸 안의 묶음 제목 */
export function MasterGroupTitle({ title, meta, actions }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-line bg-surface-2 px-4 py-1.5 text-cap font-semibold text-ink-2">
      <span>{title}</span>
      {meta !== undefined ? <span className="font-medium text-ink-3">{meta}</span> : null}
      {actions ? <span className="ml-auto flex items-center gap-1">{actions}</span> : null}
    </div>
  );
}

/** 목록 칸 아래 안내 */
export function MasterNote({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-cap leading-normal text-ink-3">{children}</p>;
}
