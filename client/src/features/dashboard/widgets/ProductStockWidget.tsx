// 제품 재고 (REQ-DSH-001): 슬래브·코일 합계 막대(예약·가용) + 규격별 재고·합격·예약·가용 (재고 화면과 같은 값, 4.2).
import { PRODUCT_QTY_UNIT, ITEM_TYPE_LABEL } from '@/codes';
import type { ProductStockData } from '@/api/dashboard';
import { Table, Td, Th } from '@/components/Table';
import { LegendItem, WidgetBody, WidgetEmpty, WidgetFrame, type WidgetProps } from '@/features/dashboard/components/WidgetFrame';
import { useDashboardWidget, useDashboardWidgetAccess } from '@/hooks/useDashboardWidget';
import { fmtInt, fmtTon } from '@/lib/format';

const pct = (part: number, whole: number): string => `${whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0}%`;

function StockBody({ data }: { data: ProductStockData }) {
  const maxOnHand = Math.max(1, ...data.totals.map((t) => t.onHandQty));
  return (
    <div className="flex flex-col gap-2.5 py-3">
      <div className="flex flex-col gap-2 px-4">
        {data.totals.map((total) => (
          <div key={total.itemType} className="flex items-center gap-2.5" title={`재고 ${fmtTon(total.onHandTon)} · 가용 ${fmtTon(total.availableTon)}`}>
            <span className="min-w-11 flex-none whitespace-nowrap text-xs font-medium text-ink-2">{ITEM_TYPE_LABEL[total.itemType]}</span>
            <div className="min-w-0 flex-1">
              {/* 너비는 실행 중에 정해지는 값이라 style로 준다. 예약·가용 뒤 남는 몫(판정 대기·불합격·배정)은 바탕색으로 보인다: 품질이 볼 몫이라 회색 대신 노랑 */}
              <div className="flex h-3.5 overflow-hidden rounded-xs bg-wait/35" style={{ width: pct(total.onHandQty, maxOnHand), minWidth: total.onHandQty ? 6 : 0 }}>
                <span className="bg-chart-1" style={{ width: pct(total.reservedQty, total.onHandQty) }} />
                <span className="bg-chart-3" style={{ width: pct(total.availableQty, total.onHandQty) }} />
              </div>
            </div>
            <span className="flex-none text-xs tabular-nums">
              가용 <b>{fmtInt(total.availableQty)}</b> / 재고 <b>{fmtInt(total.onHandQty)}</b>
              {PRODUCT_QTY_UNIT[total.itemType]}
            </span>
          </div>
        ))}
        <div className="flex flex-wrap gap-3">
          <LegendItem colorClass="bg-chart-1" label="예약" />
          <LegendItem colorClass="bg-chart-3" label="가용" />
          <LegendItem colorClass="bg-wait/35" label="판정 대기·불합격·배정" />
        </div>
      </div>
      {data.items.length === 0 ? (
        <WidgetEmpty>재고가 있는 규격이 없어요</WidgetEmpty>
      ) : (
        <Table compact className="border-t border-line [&_td]:px-2 [&_th]:px-2">
          <thead>
            <tr>
              <Th>규격</Th>
              <Th align="right">재고</Th>
              <Th align="right">합격</Th>
              <Th align="right">예약</Th>
              <Th align="right" title="가용 = 합격 − 예약 − 열연 배정">
                가용
              </Th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.itemId}>
                <Td className="max-w-56 truncate font-mono text-xs" title={item.itemCode}>
                  {item.itemCode}
                </Td>
                <Td align="right" title={fmtTon(item.onHandTon)}>
                  {fmtInt(item.onHandQty)}
                  <small className="ml-0.5 text-ink-3">{PRODUCT_QTY_UNIT[item.itemType]}</small>
                </Td>
                <Td align="right">{fmtInt(item.passedQty)}</Td>
                <Td align="right">{fmtInt(item.reservedQty)}</Td>
                <Td align="right" title={fmtTon(item.availableTon)}>
                  <b className={item.availableQty > 0 ? 'font-semibold' : 'font-normal text-ink-3'}>{fmtInt(item.availableQty)}</b>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <span className="px-4 text-cap text-ink-3">재고 = 미소진 LOT · 가용 = 합격 − 예약 − 열연 배정</span>
    </div>
  );
}

export function ProductStockWidget(props: WidgetProps) {
  const access = useDashboardWidgetAccess('PRODUCT_STOCK');
  const query = useDashboardWidget('PRODUCT_STOCK', access.allowed);
  return (
    <WidgetFrame widgetKey="PRODUCT_STOCK" {...props} meta="매수 기준">
      <WidgetBody allowed={access.allowed} permissions={access.permissions} query={query}>
        {(data) => <StockBody data={data} />}
      </WidgetBody>
    </WidgetFrame>
  );
}
