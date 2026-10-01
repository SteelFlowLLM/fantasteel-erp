'use client';

// 수주 취소 창 (REQ-SO-006, BP-SO-02). 출고분이 있으면 SO-003, 진행 중 출하요청이 있으면 SO-004로 서버가 막는다(9.3).
// 취소 사유(cancel_reason)는 필수, 200자. 비고 없음.
import { useState } from 'react';
import { InputError } from '@/api/client';
import { salesOrderApi, type SalesOrderDetail } from '@/api/salesOrders';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { useAction } from '@/hooks/useAction';
import { qtyUnitOf } from '@/features/sales/lib/salesOrderForm';

const CANCEL_REASON_MAX = 200;

export function CancelSalesOrderModal({ detail, onClose }: { detail: SalesOrderDetail; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancel = useAction(salesOrderApi.cancel, {
    success: (result) => `${result.salesOrderNo} 수주를 취소했어요`,
    onSuccess: onClose,
    onError: (e) => {
      if (e instanceof InputError) setError(e.fieldErrors.cancelReason ?? e.message);
    },
  });

  const unit = qtyUnitOf(detail.itemTypes);
  const plans = detail.items.flatMap((i) => i.plans);
  const plannedCount = plans.filter((p) => p.productionPlanStatus === 'PLANNED').length;
  const inProgressCount = plans.filter((p) => p.productionPlanStatus === 'IN_PROGRESS').length;
  const activeReservedQty = detail.items.reduce((sum, i) => sum + i.activeReservedQty, 0);

  const submit = () => {
    const text = reason.trim();
    if (text === '') {
      setError('취소 사유를 입력해 주세요');
      return;
    }
    setError(null);
    cancel.mutate({ salesOrderId: detail.id, cancelReason: text, expectedUpdatedAt: detail.updatedAt });
  };

  return (
    <Modal
      title={`수주 취소 · ${detail.salesOrderNo}`}
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button onClick={onClose} disabled={cancel.isPending}>
            닫기
          </Button>
          <Button variant="danger" onClick={submit} disabled={cancel.isPending}>
            {cancel.isPending ? '취소하는 중…' : '취소 확정'}
          </Button>
        </>
      }
    >
      <Banner tone="danger">
        <b>{detail.customerName}</b> · {detail.totalOrderedQty.toLocaleString('en-US')}
        {unit} 수주를 취소해요. 취소하면 되돌릴 수 없어요.
      </Banner>
      <div className="flex flex-col gap-2">
        <b className="text-sm font-semibold">취소하면 이렇게 돼요</b>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-5 text-ink-2">
          <li>
            예약 해제: 예약중인{' '}
            <b className="text-ink">
              {activeReservedQty.toLocaleString('en-US')}
              {unit}
            </b>
            를 해제해요. 풀린 합격 재고는 다른 수주가 쓸 수 있어요.
          </li>
          <li>
            시작 전(계획) 생산계획 <b className="text-ink">{plannedCount}건</b>을 취소해요.
          </li>
          <li>
            진행중 생산계획 <b className="text-ink">{inProgressCount}건</b>은 수주 연결을 풀고, 생산이 끝나면 여재가 돼요. 열연 배정은 해제돼요.
          </li>
          <li>모든 품목이 &lsquo;취소&rsquo; 상태가 되고, 작업 로그에 사유와 함께 남아요.</li>
        </ol>
      </div>
      <Field label="취소 사유" required error={error} hint={`작업 로그에 남아요 (${CANCEL_REASON_MAX}자 이하)`}>
        <Textarea
          value={reason}
          maxLength={CANCEL_REASON_MAX}
          invalid={Boolean(error)}
          placeholder="예: 고객사 요청으로 취소"
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </Modal>
  );
}
