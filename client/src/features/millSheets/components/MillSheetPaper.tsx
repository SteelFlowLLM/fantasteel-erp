// 밀시트 종이 (옛 MillSheetPaper · v1 B안 hl-paper 모양). 저장된 스냅샷만으로 그린다 — 마스터·검사 데이터를 다시 읽지 않는다(REQ-SHP-003).
// C 반영: '검사증명서'·출고번호·검사번호·종합 판정·'FantaSteel 제철소' 없음. 1장 = 출하요청 × 수주라 품목이 여러 줄일 수 있다.
// 히트가 여럿이면 히트마다 성분 행을 따로 보인다(14.1-9).
import type { ReactNode } from 'react';
import { INSPECTION_RESULT_LABEL, ITEM_TYPE_LABEL, PROCESS_TYPE_LABEL, PRODUCT_QTY_UNIT, type InspectionResult, type ProcessType, type ProductItemType } from '@/codes';
import type { MillSheetInspectionSnapshot, MillSheetSnapshot } from '@/api/millSheets';
import { inspectionColumns, lotRowsOf, productInspectionGroups, rangeText, standardText } from '@/features/millSheets/lib/millSheetView';
import { cn } from '@/lib/cn';
import { fmtDate, fmtDateTime, fmtDims, fmtTon } from '@/lib/format';

const isProductType = (value: string): value is ProductItemType => value === 'SLAB' || value === 'COIL';
const unitOf = (itemType: string) => (isProductType(itemType) ? PRODUCT_QTY_UNIT[itemType] : '');
const itemTypeLabel = (itemType: string) => (isProductType(itemType) ? ITEM_TYPE_LABEL[itemType] : itemType);
const processLabel = (code: string) => PROCESS_TYPE_LABEL[code as ProcessType] ?? code;
const resultLabel = (result: string) => INSPECTION_RESULT_LABEL[result as InspectionResult] ?? result;
const resultClass = (result: string | undefined) => (result === 'PASS' ? 'text-ok' : result === 'FAIL' ? 'text-danger' : 'text-ink-3');

const TABLE = 'w-full border-collapse border border-line-strong text-xs tabular-nums [&_td]:h-7 [&_td]:border-b [&_td]:border-line [&_td]:px-2.5 [&_th]:h-7 [&_th]:border-b [&_th]:border-line-strong [&_th]:bg-surface-2 [&_th]:px-2.5 [&_th]:font-medium [&_th]:text-ink-2 [&_th]:whitespace-nowrap';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 break-inside-avoid">
      <b className="text-[12.5px]">{title}</b>
      <div className="overflow-x-auto print:overflow-visible">{children}</div>
    </section>
  );
}

interface MatrixRow {
  key: string;
  head: ReactNode;
  inspection: MillSheetInspectionSnapshot | null;
}

/** 검사 항목(열) × 대상(행). 첫 행은 기준(경계 포함). */
function InspectionMatrix({ headLabel, rows, emptyText }: { headLabel: string; rows: MatrixRow[]; emptyText: string }) {
  const columns = inspectionColumns(rows.map((r) => r.inspection));
  return (
    <table className={TABLE}>
      <thead>
        <tr>
          <th className="text-left">{headLabel}</th>
          {columns.map((c) => (
            <th key={c.inspectionItemCode} className="text-right">
              {c.inspectionItemName}
              {c.unit ? ` (${c.unit})` : ''}
            </th>
          ))}
          <th className="text-left">판정</th>
          <th className="text-left">기준</th>
        </tr>
      </thead>
      <tbody>
        {columns.length > 0 ? (
          <tr>
            <td className="text-ink-3">기준</td>
            {columns.map((c) => (
              <td key={c.inspectionItemCode} className="text-right text-ink-3">
                {rangeText(c.minValue, c.maxValue)}
              </td>
            ))}
            <td />
            <td />
          </tr>
        ) : null}
        {rows.map((row) => (
          <tr key={row.key}>
            <td>{row.head}</td>
            {columns.map((c) => {
              const v = row.inspection?.values.find((x) => x.inspectionItemCode === c.inspectionItemCode);
              return (
                <td key={c.inspectionItemCode} className={cn('text-right font-semibold', v?.isPassed === false && 'text-danger')}>
                  {v?.measuredValue ?? '—'}
                </td>
              );
            })}
            <td className={resultClass(row.inspection?.inspectionResult)}>{row.inspection ? resultLabel(row.inspection.inspectionResult) : '—'}</td>
            <td className="font-mono text-ink-3">{standardText(row.inspection)}</td>
          </tr>
        ))}
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length + 3} className="text-ink-3">
              {emptyText}
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

export function MillSheetPaper({ snapshot: s }: { snapshot: MillSheetSnapshot }) {
  const lotRows = lotRowsOf(s.items);
  const hasCoil = lotRows.some((r) => r.lot.lotType === 'COIL');
  const unit = (() => {
    const units = [...new Set(s.items.map((i) => unitOf(i.itemType)))];
    return units.length === 1 ? units[0] : '';
  })();
  const groups = productInspectionGroups(lotRows);

  return (
    <article
      id="mill-sheet-paper"
      aria-label={`밀시트 ${s.millSheetNo}`}
      className="mx-auto flex w-full max-w-[1000px] flex-none flex-col gap-4 rounded-sm border border-line bg-white p-8 text-ink shadow-1 print:max-w-none print:border-0 print:p-0 print:shadow-none"
    >
      <header className="flex items-start gap-4 border-b-2 border-ink pb-3">
        <div className="flex w-56 flex-col gap-1">
          <span className="flex items-center gap-2 font-bold tracking-[.08em] text-brand">
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <rect width="24" height="24" rx="4" fill="#173A5E" />
              <rect x="6" y="5" width="3" height="14" fill="#FFFFFF" />
              <rect x="15" y="5" width="3" height="14" fill="#FFFFFF" />
              <rect x="3" y="10.5" width="18" height="3" fill="#E0762E" />
            </svg>
            FANTASTEEL
          </span>
          <span className="text-cap text-ink-3">FantaSteel</span>
        </div>
        <div className="flex flex-1 flex-col items-center gap-0.5">
          <h2 className="text-3xl font-bold tracking-[.12em]">MILL SHEET</h2>
          <span className="text-sm font-semibold tracking-[.3em]">밀시트</span>
        </div>
        <dl className="grid w-56 grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-ink-3">밀시트 번호</dt>
          <dd className="font-mono">{s.millSheetNo}</dd>
          <dt className="text-ink-3">발행일</dt>
          <dd className="tabular-nums">{s.issuedDate}</dd>
          <dt className="text-ink-3">출하요청 번호</dt>
          <dd className="font-mono">{s.shipmentRequest.shipmentRequestNo}</dd>
        </dl>
      </header>

      <dl className="grid grid-cols-[repeat(3,max-content_minmax(0,1fr))] gap-x-4 gap-y-1.5 text-[12.5px]">
        <dt className="text-ink-3">고객사</dt>
        <dd>
          {s.customer.customerName} <span className="font-mono text-ink-3">{s.customer.customerCode}</span>
        </dd>
        <dt className="text-ink-3">수주번호</dt>
        <dd className="font-mono">{s.salesOrder.salesOrderNo}</dd>
        <dt className="text-ink-3">출고 일시</dt>
        <dd className="tabular-nums">{fmtDateTime(s.shipmentRequest.issuedAt)}</dd>
        <dt className="text-ink-3">출하 요청일</dt>
        <dd className="tabular-nums">{fmtDate(s.shipmentRequest.requestedShipDate)}</dd>
        <dt className="text-ink-3">수량</dt>
        <dd className="tabular-nums">
          {s.totalQty}
          {unit}
        </dd>
        <dt className="text-ink-3">이론중량</dt>
        <dd className="tabular-nums">{fmtTon(s.totalWeightTon)}</dd>
      </dl>

      <Section title="품목">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className="w-12 text-center">품목</th>
              <th className="text-left">구분</th>
              <th className="text-left">규격</th>
              <th className="text-left">강종</th>
              <th className="text-left">적용 규격</th>
              <th className="text-right">치수 (mm)</th>
              <th className="text-right">수량</th>
              <th className="text-right">이론중량</th>
            </tr>
          </thead>
          <tbody>
            {s.items.map((item) => (
              <tr key={item.salesOrderItemId}>
                <td className="text-center">#{item.lineNo}</td>
                <td>{itemTypeLabel(item.itemType)}</td>
                <td className="font-mono">{item.itemCode}</td>
                <td className="font-mono">{item.steelGradeCode ?? '—'}</td>
                <td className="font-mono">{item.standardNo ?? '—'}</td>
                <td className="text-right">{item.thicknessMm && item.widthMm && item.lengthMm ? fmtDims(item.thicknessMm, item.widthMm, item.lengthMm) : '—'}</td>
                <td className="text-right">
                  {item.qty}
                  {unitOf(item.itemType)}
                </td>
                <td className="text-right">
                  {fmtTon(item.totalWeightTon)}{' '}
                  <span className="text-ink-3">
                    (1{unitOf(item.itemType)} {fmtTon(item.theoreticalWeightTon)})
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="1. 제품 LOT">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className="w-10 text-center">No</th>
              <th className="text-left">품목</th>
              <th className="text-left">LOT</th>
              <th className="text-left">히트</th>
              {hasCoil ? <th className="text-left">투입 슬래브</th> : null}
              <th className="text-right">이론중량</th>
              <th className="text-left">생산완료일</th>
            </tr>
          </thead>
          <tbody>
            {lotRows.map((row) => (
              <tr key={row.lot.lotId}>
                <td className="text-center">{row.no}</td>
                <td>#{row.lineNo}</td>
                <td className="font-mono">{row.lot.lotNo}</td>
                <td className="font-mono">{row.lot.heatLotNo ?? '—'}</td>
                {hasCoil ? <td className="font-mono">{row.lot.slabLotNo ?? '—'}</td> : null}
                <td className="text-right">{fmtTon(row.lot.theoreticalWeightTon)}</td>
                <td className="tabular-nums">{row.lot.producedDate}</td>
              </tr>
            ))}
            {lotRows.length === 0 ? (
              <tr>
                <td colSpan={hasCoil ? 7 : 6} className="text-ink-3">
                  출고 LOT이 없어요
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="font-semibold [&_td]:bg-surface-2">
              <td />
              <td colSpan={hasCoil ? 4 : 3}>
                합계 {s.totalQty}
                {unit}
              </td>
              <td className="text-right">{fmtTon(s.totalWeightTon)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </Section>

      <Section title="2. 화학성분 (히트 성분 검사)">
        <InspectionMatrix
          headLabel="히트"
          rows={s.heats.map((h) => ({ key: String(h.heatLotId), head: <span className="font-mono">{h.heatLotNo}</span>, inspection: h.inspection }))}
          emptyText="히트 성분 검사값이 없어요"
        />
      </Section>

      {groups.length === 0 ? (
        <Section title="3. 제품 검사">
          <InspectionMatrix headLabel="No" rows={[]} emptyText="제품 검사값이 없어요" />
        </Section>
      ) : (
        groups.map((group, index) => (
          <Section key={group.processType} title={`3${groups.length > 1 ? `-${index + 1}` : ''}. 제품 검사 (${processLabel(group.processType)})`}>
            <InspectionMatrix
              headLabel="No · LOT"
              rows={group.rows.map((r) => ({
                key: String(r.lot.lotId),
                head: (
                  <span>
                    {r.no} <span className="font-mono text-ink-3">{r.lot.lotNo}</span>
                  </span>
                ),
                inspection: r.lot.productInspection,
              }))}
              emptyText="제품 검사값이 없어요"
            />
          </Section>
        ))
      )}

      <footer className="mt-auto flex flex-wrap items-center gap-3 border-t border-line-strong pt-2.5 text-xs">
        <span className="text-ink-2">위 제품은 해당 규격에 따라 제조·검사되었음을 증명합니다.</span>
        <span className="ml-auto text-ink-3">출고 확정 때 자동 발행 · 발행 시점 스냅샷 ({fmtDateTime(s.issuedAt)})</span>
      </footer>
    </article>
  );
}
