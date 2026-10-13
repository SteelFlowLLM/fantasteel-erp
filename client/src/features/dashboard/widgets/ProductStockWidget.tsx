// 제품 재고 (REQ-DSH-001): 슬래브·코일 합계 막대(재고 중 가용) + 규격별 재고·합격·예약·가용 (재고 화면과 같은 값, 4.2).
import { PRODUCT_QTY_UNIT, ITEM_TYPE_LABEL } from '@/codes';
import type { ProductStockData } from '@/api/dashboard';
import { Table, Td, Th } from '@/components/Table';
import { LegendItem, WidgetBody, WidgetEmpty, WidgetFrame, type WidgetProps } from '@/features/dashboard/components/WidgetFrame';
import { useDashboardWidget, useDashboardWidgetAccess } from '@/hooks/useDashboardWidget';
import { cn } from '@/lib/cn';
import { fmtInt, fmtTon } from '@/lib/format';

const pct = (part: number, whole: number): string => `${whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0}%`;

function StockBody({ data }: { data: ProductStockData }) {
  return (
    <div className="flex flex-col gap-2.5 py-3">
      <div className="flex flex-col gap-2 px-4">
        {data.totals.map((total) => (
          <div
            key={total.itemType}
            data-pet-item="inventory"
            data-pet-item-title={ITEM_TYPE_LABEL[total.itemType]}
            className="flex items-center gap-2.5"
            title={`재고 ${fmtTon(total.onHandTon)} · 가용 ${fmtTon(total.availableTon)}`}
          >
            <span className="min-w-11 flex-none whitespace-nowrap text-xs font-medium text-ink-2">{ITEM_TYPE_LABEL[total.itemType]}</span>
            <div className="min-w-0 flex-1">
              {/* 막대 = 옆 숫자 "가용 / 재고": 막대 전체가 그 제품의 재고, 채운 몫이 가용이다.
                  슬래브(매)와 코일(개)은 단위가 달라 한 눈금으로 길이를 견주지 않는다. 너비는 실행 중에 정해지는 값이라 style로 준다 */}
              <div className={cn('flex h-3.5 overflow-hidden rounded-xs', total.onHandQty > 0 ? 'bg-chart-4' : 'bg-surface-3')}>
                <span className="bg-chart-1" style={{ width: pct(total.availableQty, total.onHandQty) }} />
              </div>
            </div>
            <span className="flex-none text-xs tabular-nums">
              가용 <b data-pet-field="가용">{fmtInt(total.availableQty)}</b> / 재고 <b data-pet-field="재고">{fmtInt(total.onHandQty)}</b>
              {PRODUCT_QTY_UNIT[total.itemType]}
            </span>
          </div>
        ))}
        <div className="flex flex-wrap gap-3">
          <LegendItem colorClass="bg-chart-1" label="가용" />
          <LegendItem colorClass="bg-chart-4" label="재고" />
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
              <tr key={item.itemId} data-pet-item="inventory" data-pet-item-title={item.itemCode}>
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
