// 납기 위험 수주 (REQ-DSH-002) — 규칙 판정(AI 아님)
import { Link } from 'react-router';
import type { DeliveryRiskWidget as Data } from '@/api/dashboard';
import { EmptyNote, Icon } from '@/components/ui';
import { fmtMD, fmtTon } from '@/lib/format';
import { dueLabel } from '@/features/dashboard/parts';

export function DeliveryRiskWidget({ data }: { data: Data }) {
  return (
    <div className="hl-card__body hl-card__body--flush">
      <table className="hl-table hl-table--compact">
        <thead>
          <tr>
            <th>수주번호</th>
            <th>고객사</th>
            <th>품목</th>
            <th className="num">출하 / 주문</th>
            <th className="num">남은 수량</th>
            <th title={data.rule}>납기</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((it) => (
            <tr key={it.salesOrderItemId} className={it.isOverdue ? 'is-risk' : undefined}>
              <td><Link className="hl-link-id" to={it.linkPath}>{it.salesOrderNo}</Link> <span className="hl-cap">#{it.lineNo}</span></td>
              <td><span className="dsh-clip" style={{ maxWidth: 140 }} title={it.customerName}>{it.customerName}</span></td>
              <td><span className="mono dsh-clip" style={{ maxWidth: 210 }} title={it.specCode}>{it.specCode}</span></td>
              <td className="num">{it.shippedQty} / {it.orderedQty}</td>
              <td className="num" title={fmtTon(it.remainingTon)}><b>{it.remainingQty}</b></td>
              <td>
                <span className={it.isOverdue ? 'hl-risk' : 'hl-wait-text'} style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {it.isOverdue ? <Icon name="alert" size="sm" /> : null}
                  {fmtMD(it.dueDate)} ({dueLabel(it.daysToDue)})
                </span>
              </td>
            </tr>
          ))}
          {!data.items.length ? <tr><td colSpan={6}><EmptyNote>납기 위험 수주가 없어요</EmptyNote></td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
