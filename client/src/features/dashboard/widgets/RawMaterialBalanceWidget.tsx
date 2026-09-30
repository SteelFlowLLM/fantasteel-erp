// 원료 잔량 대비 소요 (REQ-DSH-002)
import type { RawMaterialBalanceWidget as Data } from '@/api/dashboard';
import { EmptyNote } from '@/components/ui';
import { fmtTon } from '@/lib/format';
import { pctW } from '@/features/dashboard/parts';

export function RawMaterialBalanceWidget({ data }: { data: Data }) {
  return (
    <div className="hl-card__body hl-card__body--flush">
      <table className="hl-table hl-table--compact">
        <thead>
          <tr>
            <th>원료</th>
            <th className="num">잔량</th>
            <th className="num">입고 예정</th>
            <th className="num">총소요 (MRP)</th>
            <th className="num">순소요</th>
            <th style={{ width: 120 }} title="잔량 ÷ 총소요를 막대 길이로 보여줘요">잔량 / 총소요</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((m) => {
            const net = m.netRequiredTon === null ? null : Number(m.netRequiredTon);
            const gross = m.grossRequiredTon === null ? null : Number(m.grossRequiredTon);
            const short = net !== null && net > 0;
            return (
              <tr key={m.rawMaterialId} className={short ? 'is-risk' : undefined}>
                <td>
                  <span className="dsh-clip" style={{ maxWidth: 160 }} title={`${m.materialName} (${m.materialCode}) · ${m.rawMaterialTypeLabel}`}>
                    <b>{m.materialName}</b> <span className="mono hl-muted">{m.materialCode}</span>
                  </span>
                </td>
                <td className="num">{fmtTon(m.onHandTon)}</td>
                <td className={Number(m.scheduledReceiptTon) > 0 ? 'num' : 'num hl-muted'}>{fmtTon(m.scheduledReceiptTon)}</td>
                <td className="num">{m.grossRequiredTon === null ? <span className="hl-muted">—</span> : fmtTon(m.grossRequiredTon)}</td>
                <td className="num">
                  {net === null ? <span className="hl-muted">—</span> : short ? <b className="hl-danger-text">부족 {fmtTon(m.netRequiredTon)}</b> : fmtTon(m.netRequiredTon)}
                </td>
                <td>
                  {gross !== null && gross > 0 ? (
                    <div className={`hl-progress ${short ? 'hl-progress--danger' : 'hl-progress--ok'}`}><span style={{ width: pctW(Number(m.onHandTon), gross) }} /></div>
                  ) : (
                    <span className="hl-muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {!data.items.length ? <tr><td colSpan={6}><EmptyNote>등록된 원료가 없어요</EmptyNote></td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
