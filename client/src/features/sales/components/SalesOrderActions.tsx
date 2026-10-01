'use client';

// 수주 머리의 버튼들: 업무방 열기 · 출하요청 만들기 · 품목 충족 지표 묶음 (목록 미리보기와 상세가 함께 쓴다)
import { useState } from 'react';
import { PERMISSION, RESERVATION_STATUS_LABEL } from '@/codes';
import type { ItemFulfillment, SalesOrderSummary } from '@/api/salesOrders';
import { Button, ButtonLink, type ButtonSize } from '@/components/Button';
import { useCanUse } from '@/hooks/usePermission';
import { permissionNeedText } from '@/lib/permissions';
import { OpenWorkRoomModal } from '@/features/sales/components/OpenWorkRoomModal';
import { MeasureBar } from '@/features/sales/components/SalesOrderParts';
import { qtyUnitOf } from '@/features/sales/lib/salesOrderForm';

/** 업무방 열기·가기. 취소된 수주에는 새 업무방을 열지 않는다(이미 있는 방은 그대로 갈 수 있다) */
export function WorkRoomButton({
  salesOrderId,
  salesOrderNo,
  hasRoom,
  cancelled = false,
  size = 'sm',
}: {
  salesOrderId: number;
  salesOrderNo: string;
  hasRoom: boolean;
  cancelled?: boolean;
  size?: ButtonSize;
}) {
  const [open, setOpen] = useState(false);
  if (cancelled && !hasRoom) return null;
  return (
    <>
      <Button size={size} icon="hash" onClick={() => setOpen(true)}>
        {hasRoom ? '업무방' : '업무방 열기'}
      </Button>
      {open ? <OpenWorkRoomModal salesOrderId={salesOrderId} salesOrderNo={salesOrderNo} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** 출하요청 만들기: 출하요청 관리 사용 권한 + 출하완료가 아닌 수주만 (보고서 1 C-5-14). 취소된 수주에는 보이지 않는다 */
export function ShipmentRequestButton({ summary, size = 'sm' }: { summary: Pick<SalesOrderSummary, 'id' | 'status'>; size?: ButtonSize }) {
  const canRequest = useCanUse(PERMISSION.SHIPMENT_REQUEST_MANAGE);
  if (summary.status === 'CANCELLED') return null;
  const blocked = summary.status === 'SHIPPED' ? '모두 출하했어요' : canRequest ? null : permissionNeedText([PERMISSION.SHIPMENT_REQUEST_MANAGE]);
  if (blocked) {
    return (
      <Button size={size} icon="truck" disabled title={blocked}>
        출하요청 만들기
      </Button>
    );
  }
  return (
    <ButtonLink size={size} icon="truck" href={`/shipment-requests/new?salesOrderId=${summary.id}`}>
      출하요청 만들기
    </ButtonLink>
  );
}

/**
 * 품목 하나의 충족 지표 4개 (REQ-SO-004). 분모를 지표마다 따로 보인다 (업무 프로세스 4.5):
 * 예약 ÷ 미출하 매수, 생산중·검사합격·출하 ÷ 수주 매수.
 */
export function FulfillmentMeasures({ item, compact }: { item: ItemFulfillment; compact?: boolean }) {
  const unit = qtyUnitOf([item.itemType]);
  return (
    <div className={compact ? 'grid grid-cols-2 gap-x-3 gap-y-2' : 'grid grid-cols-4 gap-3'}>
      <div className="flex flex-col gap-0.5">
        <span className="text-cap text-ink-3" title={`${RESERVATION_STATUS_LABEL.ACTIVE} 매수 ÷ 미출하 매수`}>
          예약 <span className="text-ink-3">÷ 미출하</span>
        </span>
        <MeasureBar label="예약" unit={unit} tone="brand" measure={item.measures.reserved} />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-cap text-ink-3" title="진행중·완료 생산계획의 잔여 목표 ÷ 수주 매수">
          생산중 <span className="text-ink-3">÷ 수주</span>
        </span>
        <MeasureBar label="생산중" unit={unit} tone="muted" measure={item.measures.inProduction} />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-cap text-ink-3" title="이 품목 몫으로 확보한 합격 제품(예약 + 출하) ÷ 수주 매수">
          검사합격 <span className="text-ink-3">÷ 수주</span>
        </span>
        <MeasureBar label="검사합격" unit={unit} tone="ok" measure={item.measures.passed} />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-cap text-ink-3" title="출고 확정 매수 ÷ 수주 매수">
          출하 <span className="text-ink-3">÷ 수주</span>
        </span>
        <MeasureBar label="출하" unit={unit} tone="run" measure={item.measures.shipped} />
      </div>
    </div>
  );
}
