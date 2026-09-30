// 수주 취소 (REQ-SO-006, BP-SO-02): 사유를 받고, 취소하면 무엇이 바뀌는지 알려 준 뒤, 서버가 돌려준 결과를 보여 준다.
import { useState } from 'react';
import { Link } from 'react-router';
import { SALES_ORDER_ITEM_STATUS_LABEL } from '@fantasteel/shared';
import { salesOrderApi, type FulfillmentView, type SalesOrderView } from '@/api/salesOrders';
import { Badge, Field, Icon, Modal } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { fmtDateTime } from '@/lib/format';
import { ItemTitle, STATUS_TONE, StatusBadge, eventsHref, sumOf, unitOf } from './salesUi';

export function CancelOrderModal({ order, onClose }: { order: FulfillmentView; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<SalesOrderView | null>(null);
  const cancel = useAction((r: string) => salesOrderApi.cancel(order.id, r.trim() || undefined), {
    success: `${order.salesOrderNo} 수주를 취소했어요`,
    invalidate: ['sales-orders', 'inventories', 'production-plans', 'shipment-requests', 'allocations', 'business-events'],
    onSuccess: setResult,
  });
  const unit = unitOf(order.items);
  const active = sumOf(order.items, (it) => it.reservedQty + it.passedQty);
  const openPlans = order.items.flatMap((it) => it.productionPlans).filter((p) => p.productionPlanStatus !== 'COMPLETED' && p.productionPlanStatus !== 'CANCELLED');

  if (result) {
    return (
      <Modal
        title={<>취소 결과 · <span className="mono">{result.salesOrderNo}</span></>}
        onClose={onClose}
        width={600}
        footer={
          <>
            <Link className="hl-btn" to={eventsHref(result.id)} onClick={onClose}><Icon name="history" />작업 로그에서 보기</Link>
            <button className="hl-btn hl-btn--primary" type="button" onClick={onClose}>확인</button>
          </>
        }
      >
        <div className="hl-col" style={{ gap: 12 }}>
          <div className="hl-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <StatusBadge status={result.salesOrderStatus} />
            <span className="hl-cap">{fmtDateTime(result.cancelledAt)} 취소{result.cancelReason ? ` · 사유: ${result.cancelReason}` : ''}</span>
          </div>
          <table className="hl-table hl-table--compact">
            <thead><tr><th>품목</th><th>상태</th><th className="num">주문</th><th className="num">출하 (유지)</th><th className="num">취소 잔량</th></tr></thead>
            <tbody>
              {result.items.map((it) => (
                <tr key={it.id}>
                  <td><ItemTitle it={it} /></td>
                  <td><Badge tone={STATUS_TONE[it.salesOrderItemStatus]}>{SALES_ORDER_ITEM_STATUS_LABEL[it.salesOrderItemStatus]}</Badge></td>
                  <td className="num">{it.orderedQty}{it.qtyUnit}</td>
                  <td className="num">{it.shippedQty}{it.qtyUnit}</td>
                  <td className="num">{it.cancelledQty}{it.qtyUnit}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <span className="hl-cap">예약은 해제되고 가용재고로 돌아갔어요. 이미 출하된 수량과 밀시트는 그대로예요. 해제된 예약·배정, 취소된 생산계획, 여재 전환은 작업 로그에 남아 있어요.</span>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={<>수주 취소 · <span className="mono">{order.salesOrderNo}</span></>}
      onClose={onClose}
      width={600}
      footer={
        <>
          <button className="hl-btn" type="button" onClick={onClose}>닫기</button>
          <button className="hl-btn hl-btn--danger-outline" type="button" disabled={cancel.isPending} onClick={() => cancel.mutate(reason)}>
            <Icon name="x-circle" />{cancel.isPending ? '취소하는 중…' : '취소 확정'}
          </button>
        </>
      }
    >
      <div className="hl-col" style={{ gap: 12 }}>
        <div className="hl-banner hl-banner--danger" style={{ padding: '8px 12px' }}>
          <Icon name="alert" />
          <span>{order.customer.customerName} · {order.orderedQty}{unit} 수주를 취소해요. 취소하면 되돌릴 수 없어요.</span>
        </div>
        <div className="hl-col" style={{ gap: 6, fontSize: 12.5 }}>
          <b>취소하면 이렇게 돼요</b>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li><b>예약 해제</b> — 지금 잡혀 있는 예약 {active}{unit}가 해제되어 가용재고로 돌아가요.</li>
            <li><b>배정 해제</b> — 아직 출고하지 않은 출하요청은 요청 전체가 취소되고 확정 배정이 풀려요. 같은 출하요청에 묶인 다른 수주 품목은 다시 출하요청해야 해요.</li>
            <li><b>시작 전 생산계획 취소</b> — 진행 중인 계획 {openPlans.length}건 가운데 아직 생산을 시작하지 않은 계획은 취소돼요.</li>
            <li><b>생산 중 물량은 완료 후 여재</b> — 이미 생산 중인 물량은 수주 연결만 끊고, 생산·검사가 끝나면 슬래브 여재가 돼요.</li>
            <li><b>출하분은 그대로</b> — 이미 출하된 {order.shippedQty}{unit}와 밀시트는 바뀌지 않아요. 일부 출하된 품목은 남은 수량만 취소돼요.</li>
          </ul>
        </div>
        <Field label="취소 사유" hint="작업 로그에 남아요 (선택, 500자 이하)">
          <input className="hl-input" type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 고객 요청" autoFocus />
        </Field>
      </div>
    </Modal>
  );
}
