// 수주 상세 · 예약 탭 (REQ-INV-002·004·005): 이 수주 품목의 예약 행. 예약은 매수 단위이고 LOT을 정하지 않는다.
import type { SalesOrderDetail } from '@/api/salesOrders';
import { Card } from '@/components/Card';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { fmtDateTime, fmtTon } from '@/lib/format';
import { calcWeightTon } from '@/lib/weight';
import { ReservationStatusBadge } from '@/features/sales/components/SalesOrderParts';
import { qtyUnitOf } from '@/features/sales/lib/salesOrderForm';

export function ReservationTab({ detail }: { detail: SalesOrderDetail }) {
  const itemOf = (soItemId: number) => detail.items.find((i) => i.salesOrderItemId === soItemId);
  return (
    <Card>
      {detail.reservations.length === 0 ? (
        <EmptyNote className="py-8">예약이 없어요</EmptyNote>
      ) : (
        <div className="overflow-auto">
          <Table>
            <thead>
              <tr>
                <Th>품목</Th>
                <Th>규격 코드</Th>
                <Th>상태</Th>
                <Th align="right">예약 매수</Th>
                <Th align="right" title="매수 × 1매 이론중량 계산값">
                  톤 (계산값)
                </Th>
                <Th>생성</Th>
                <Th>변경</Th>
              </tr>
            </thead>
            <tbody>
              {detail.reservations.map((r) => {
                const item = itemOf(r.salesOrderItemId);
                const unit = item ? qtyUnitOf([item.itemType]) : '매';
                return (
                  <tr key={r.id} data-muted={r.reservationStatus === 'RELEASED'}>
                    <Td>품목 {r.lineNo}</Td>
                    <Td className="font-mono text-xs">{r.itemCode}</Td>
                    <Td>
                      <ReservationStatusBadge status={r.reservationStatus} />
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {r.reservedQty}
                      {unit}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {item ? fmtTon(calcWeightTon(r.reservedQty, item.unitWeightTon)) : '-'}
                    </Td>
                    <Td className="tabular-nums">{fmtDateTime(r.createdAt)}</Td>
                    <Td className="tabular-nums">{r.updatedAt === r.createdAt ? '-' : fmtDateTime(r.updatedAt)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
      <div className="border-t border-line px-4 py-2.5 text-cap leading-[18px] text-ink-3">
        수주 등록 때 합격 재고를 먼저 예약하고, 부족분은 생산·검사 합격 뒤 자동 예약해요. 출고가 확정되면 &lsquo;출고 전환&rsquo;, 수주를 취소하면
        &lsquo;해제&rsquo;가 돼요. 부분 출고는 예약을 둘로 나눠요. 누가 예약했는지는 이력 탭에서 볼 수 있어요.
      </div>
    </Card>
  );
}
