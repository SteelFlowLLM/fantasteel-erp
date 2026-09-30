// 수주 충족 현황 (REQ-DSH-001): 진행 중 수주의 품목별 예약·생산 중·출하 매수와 진행률(출하 ÷ 주문).
import { Link } from 'react-router';
import type { OrderFulfillmentItem, OrderFulfillmentWidget as Data } from '@/api/dashboard';
import { EmptyNote, Icon } from '@/components/ui';
import { fmtMD, fmtTon } from '@/lib/format';
import { dueLabel, pctW, rateText } from '@/features/dashboard/parts';

const COLOR = { shipped: '#5E6977', reserved: '#23507F', inProduction: '#1F5FCC' } as const;

// 기본 크기(카드 본문 ≈650px)에서 진행률·납기까지 가로 스크롤 없이 보이게: 열 너비를 고정(px)하고 칸 여백을 줄인다.
// 품목(undefined)만 남는 폭을 받아 말줄임(…) + title. 더 작게 줄이면 표 최소 폭부터 카드 안에서 가로 스크롤.
const COL_W = [128, 76, undefined, 38, 38, 38, 48, 84, 72]; // 수주번호·고객사·품목·주문·출하·예약·생산 중·진행률·납기
const TABLE_MIN_W = COL_W.reduce<number>((a, w) => a + (w ?? 100), 0);
const PAD = { paddingInline: 4 } as const;

/** 출하·예약·생산 중은 서로 다른 단계라 합쳐서 숫자로 쓰지 않고, 주문 매수 대비 길이로만 나란히 보여준다. */
function StageBar({ it }: { it: OrderFulfillmentItem }) {
  const whole = Math.max(it.orderedQty, it.shippedQty + it.reservedQty + it.inProductionQty);
  const seg = (qty: number, color: string, label: string) =>
    qty > 0 ? <span style={{ width: pctW(qty, whole), background: color }} title={`${label} ${qty}`} /> : null;
  return (
    <div className="hl-progress-cell" style={{ gap: 6 }}>
      <div className="hl-bar-track" style={{ flex: 1, height: 12, minWidth: 30 }}>
        {seg(it.shippedQty, COLOR.shipped, '출하')}
        {seg(it.reservedQty, COLOR.reserved, '예약')}
        {seg(it.inProductionQty, COLOR.inProduction, '생산 중')}
      </div>
      <b className="tnum">{rateText(it.progressRate)}</b>
    </div>
  );
}

export function OrderFulfillmentWidget({ data }: { data: Data }) {
  const d = data.definitions;
  return (
    <>
      <div className="hl-card__body hl-card__body--flush">
        <table className="hl-table hl-table--compact" style={{ tableLayout: 'fixed', minWidth: TABLE_MIN_W }}>
          <colgroup>{COL_W.map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}</colgroup>
          <thead>
            <tr>
              <th style={PAD}>수주번호</th>
              <th style={PAD}>고객사</th>
              <th style={PAD}>품목</th>
              <th className="num" style={PAD}>주문</th>
              <th className="num" style={PAD}>출하</th>
              <th className="num" style={PAD} title={d.reservedQty}>예약</th>
              <th className="num" style={PAD} title={d.inProductionQty}>생산 중</th>
              <th style={PAD} title={d.progressRate}>진행률</th>
              <th style={PAD}>납기</th>
            </tr>
          </thead>
          <tbody>
            {data.salesOrders.map((o) => {
              const n = Math.max(1, o.items.length);
              const top = n > 1 ? ({ ...PAD, verticalAlign: 'top', paddingTop: 7 } as const) : PAD;
              const due = <>{fmtMD(o.dueDate)} <span style={{ whiteSpace: 'nowrap' }}>({dueLabel(o.daysToDue)})</span></>; // 좁으면 날짜 / (D-n) 두 줄로
              const head = (
                <>
                  <td rowSpan={n} style={top}><Link className="hl-link-id" to={o.linkPath}>{o.salesOrderNo}</Link></td>
                  <td rowSpan={n} style={top}><span className="dsh-clip" title={o.customerName}>{o.customerName}</span></td>
                </>
              );
              const tail = (
                <td rowSpan={n} className={o.isDeliveryRisk ? undefined : 'tnum'} style={{ ...top, whiteSpace: 'normal', lineHeight: '15px' }}>
                  {o.isDeliveryRisk ? <span className="hl-risk" title={`납기 ${data.deliveryRiskDays}일 이내 · 출하 남음`}><Icon name="alert" size="sm" /><span>{due}</span></span> : due}
                </td>
              );
              if (!o.items.length) {
                return (
                  <tr key={o.salesOrderId} className={o.isDeliveryRisk ? 'is-risk' : undefined}>
                    {head}
                    <td colSpan={6} className="hl-muted" style={PAD}>품목 없음</td>
                    {tail}
                  </tr>
                );
              }
              return o.items.map((it, i) => (
                <tr key={it.salesOrderItemId} className={o.isDeliveryRisk ? 'is-risk' : undefined}>
                  {i === 0 ? head : null}
                  <td style={i > 0 ? { ...PAD, borderLeft: '1px solid var(--line)' } : PAD}><span className="mono dsh-clip" title={it.specCode}>{it.specCode}</span></td>
                  <td className="num" style={PAD} title={fmtTon(it.orderedTon)}><span className="hl-sheets">{it.orderedQty}</span></td>
                  <td className="num" style={PAD}>{it.shippedQty}</td>
                  <td className="num" style={PAD}>{it.reservedQty}</td>
                  <td className="num" style={PAD}>{it.inProductionQty}</td>
                  <td style={PAD}><StageBar it={it} /></td>
                  {i === 0 ? tail : null}
                </tr>
              ));
            })}
            {!data.salesOrders.length ? <tr><td colSpan={9}><EmptyNote>진행 중인 수주가 없어요</EmptyNote></td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="hl-card__foot dsh-foot" title={d.note}>
        <div className="hl-legend">
          <span><i style={{ background: COLOR.shipped }} />출하</span>
          <span><i style={{ background: COLOR.reserved }} />예약</span>
          <span><i style={{ background: COLOR.inProduction }} />생산 중</span>
        </div>
        <span className="hl-cap dsh-clip" title={d.progressRate}>진행률 = {d.progressRate}</span>
      </div>
    </>
  );
}
