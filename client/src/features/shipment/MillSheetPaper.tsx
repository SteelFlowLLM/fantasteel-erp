// 밀시트 종이 (v1 B안 26번의 hl-paper). 저장된 스냅샷(MillSheetSnapshot)만으로 그린다 — 원본 마스터·검사 데이터를 다시 조회하지 않는다.
import type { CSSProperties, ReactNode } from 'react';
import { INSPECTION_RESULT_LABEL, PROCESS_CODE_LABEL, type InspectionResult, type ProcessCode } from '@fantasteel/shared';
import type { MillSheetInspection, MillSheetInspectionValue, MillSheetSnapshot } from '@/api/shipments';
import { fmtDate, fmtDateTime, fmtDims, fmtTon } from '@/lib/format';
import { LotLink, itemTypeLabel } from './shipmentUi';

const cellTh = { padding: '6px 10px', background: '#F4F6F8' } as const;
const LINE = '1px solid #C3CBD4';

/** 판정 기준: "0.10~0.25" / "≤0.25" / "≥270" / "—" */
function rangeText(v: Pick<MillSheetInspectionValue, 'minValue' | 'maxValue'>): string {
  if (v.minValue !== null && v.maxValue !== null) return `${v.minValue}~${v.maxValue}`;
  if (v.maxValue !== null) return `≤${v.maxValue}`;
  if (v.minValue !== null) return `≥${v.minValue}`;
  return '—';
}
const resultLabel = (r: string) => INSPECTION_RESULT_LABEL[r as InspectionResult] ?? r;
const resultClass = (r: string | null | undefined) => (!r ? 'hl-muted' : r === 'PASS' ? 'hl-ok-text' : r === 'FAIL' ? 'hl-danger-text' : 'hl-muted');
const processLabel = (code: string) => PROCESS_CODE_LABEL[code as ProcessCode] ?? code;

interface MatrixRow { key: string; head: ReactNode; title?: string; inspection: MillSheetInspection | null }

/** 검사 항목(열) × 대상(행) 표. 열은 행들의 검사 항목을 나온 순서대로 모은 것, 기준은 그 항목이 처음 나온 검사의 값. */
function InspectionMatrix({ headLabel, rows, showUnit = true, emptyText }: { headLabel: string; rows: MatrixRow[]; showUnit?: boolean; emptyText: string }) {
  const cols: MillSheetInspectionValue[] = [];
  for (const r of rows) for (const v of r.inspection?.values ?? []) if (!cols.some((c) => c.inspectionItemCode === v.inspectionItemCode)) cols.push(v);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="hl-table">
        <thead>
          <tr>
            <th>{headLabel}</th>
            {cols.map((c) => <th key={c.inspectionItemCode} className="num">{c.inspectionItemName}{showUnit && c.unit ? ` (${c.unit})` : ''}</th>)}
            <th>판정</th>
            <th>검사번호</th>
          </tr>
        </thead>
        <tbody>
          {cols.length ? (
            <tr>
              <td className="hl-muted">기준</td>
              {cols.map((c) => <td key={c.inspectionItemCode} className="num hl-muted">{rangeText(c)}</td>)}
              <td />
              <td />
            </tr>
          ) : null}
          {rows.map((r) => (
            <tr key={r.key}>
              <td title={r.title}>{r.head}</td>
              {cols.map((c) => {
                const v = r.inspection?.values.find((x) => x.inspectionItemCode === c.inspectionItemCode);
                return <td key={c.inspectionItemCode} className={`num${v?.isPassed === false ? ' hl-danger-text' : ''}`} style={{ fontWeight: 600 }}>{v?.measuredValue ?? '—'}</td>;
              })}
              <td className={resultClass(r.inspection?.inspectionResult)}>{r.inspection ? resultLabel(r.inspection.inspectionResult) : '—'}</td>
              <td className="mono hl-muted">{r.inspection?.qualityInspectionNo ?? '—'}</td>
            </tr>
          ))}
          {!rows.length ? <tr><td colSpan={cols.length + 3} className="hl-muted">{emptyText}</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

export function MillSheetPaper({ snapshot: s, style }: { snapshot: MillSheetSnapshot; style?: CSSProperties }) {
  const spec = s.productSpec;
  const isCoil = spec.itemType === 'COIL';
  const lotRows: MatrixRow[] = s.lots.map((l, i) => ({ key: l.lotNo, head: <span className="tnum">{i + 1}</span>, title: l.lotNo, inspection: l.inspection }));
  const slabRows: MatrixRow[] = s.lots.filter((l) => l.parentSlab).map((l) => ({ key: l.parentSlab!.lotNo, head: <LotLink lotNo={l.parentSlab!.lotNo} />, inspection: l.parentSlab!.inspection }));
  const heatRows: MatrixRow[] = s.heats.map((h) => ({ key: h.heatNo, head: <span className="mono">{h.heatNo}</span>, inspection: h.composition }));
  // 종합 판정: 스냅샷에 담긴 검사(히트 성분·제품·압연 전 슬래브)의 판정만 본다
  const inspections = [...s.heats.map((h) => h.composition), ...s.lots.map((l) => l.inspection), ...s.lots.filter((l) => l.parentSlab).map((l) => l.parentSlab!.inspection)];
  const hasAll = inspections.length > 0 && inspections.every((x) => x !== null);
  const pass = hasAll && inspections.every((x) => x!.inspectionResult === 'PASS');
  const fail = inspections.some((x) => x?.inspectionResult === 'FAIL');
  const verdictColor = pass ? '#17794A' : fail ? '#C0322B' : '#5B6775';
  const lotProcess = s.lots.find((l) => l.inspection)?.inspection?.processCode;
  const unitWeight = spec.theoreticalWeightTon;

  return (
    <article className="hl-paper" aria-label={`밀시트 ${s.millSheetNo}`} style={style}>
      <div className="hl-row" style={{ alignItems: 'flex-start', gap: 16, paddingBottom: 12, borderBottom: '2px solid #121820' }}>
        <div className="hl-col" style={{ gap: 4, width: 220 }}>
          <span className="hl-row" style={{ gap: 8, fontWeight: 700, letterSpacing: '.08em', color: '#173A5E' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <rect width="24" height="24" rx="4" fill="#173A5E" />
              <rect x="6" y="5" width="3" height="14" fill="#FFFFFF" />
              <rect x="15" y="5" width="3" height="14" fill="#FFFFFF" />
              <rect x="3" y="10.5" width="18" height="3" fill="#E0762E" />
            </svg>
            FANTASTEEL
          </span>
          <span className="hl-cap">FantaSteel 제철소</span>
        </div>
        <div className="hl-col" style={{ flex: 1, alignItems: 'center', gap: 2 }}>
          <h2>MILL SHEET</h2>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '.3em' }}>검사증명서</span>
        </div>
        <dl className="hl-kv" style={{ rowGap: 3, fontSize: 12, width: 220 }}>
          <dt>발행번호</dt>
          <dd className="mono">{s.millSheetNo}</dd>
          <dt>발행일</dt>
          <dd className="tnum">{fmtDate(s.issuedAt)}</dd>
          <dt>출고번호</dt>
          <dd className="mono">{s.shipment.goodsIssueNo}</dd>
        </dl>
      </div>

      <dl className="hl-kv ms-kv" style={{ rowGap: 6, fontSize: 12.5 }}>
        <dt>고객사</dt>
        <dd>{s.customer.customerName} <span className="mono hl-muted">{s.customer.customerCode}</span></dd>
        <dt>수주번호</dt>
        <dd className="mono">{s.salesOrder.salesOrderNo} #{s.salesOrder.lineNo}</dd>
        <dt>출하요청</dt>
        <dd className="mono">{s.shipment.shipmentRequestNo}</dd>
        <dt>품목</dt>
        <dd>{itemTypeLabel(spec.itemType)} <span className="mono">{spec.specCode}</span></dd>
        <dt>강종</dt>
        <dd><span className="mono">{spec.steelGradeCode}</span> {spec.steelGradeName}</dd>
        <dt>적용 규격</dt>
        <dd className="mono">{spec.standardNo ?? '—'}</dd>
        <dt>치수 (mm)</dt>
        <dd className="tnum">{fmtDims(spec.thicknessMm, spec.widthMm, spec.lengthMm)}</dd>
        <dt>수량</dt>
        <dd className="tnum">{s.qty}{s.qtyUnit}</dd>
        <dt>이론중량</dt>
        <dd className="tnum">{fmtTon(s.weightTon)} <span className="hl-muted">(1{s.qtyUnit} {fmtTon(unitWeight)})</span></dd>
      </dl>

      <div className="hl-col" style={{ gap: 6 }}>
        <b style={{ fontSize: 12.5 }}>1. 제품 LOT</b>
        <div style={{ overflowX: 'auto' }}>
          <table className="hl-table">
            <thead>
              <tr>
                <th className="ctr" style={{ width: 40 }}>No</th>
                <th>{isCoil ? '코일 LOT' : '슬래브 LOT'}</th>
                <th>히트</th>
                {isCoil ? <th>압연 전 슬래브</th> : null}
                <th className="num">이론중량</th>
                <th>생산완료일</th>
              </tr>
            </thead>
            <tbody>
              {s.lots.map((l, i) => (
                <tr key={l.lotNo}>
                  <td className="ctr">{i + 1}</td>
                  <td><LotLink lotNo={l.lotNo} /></td>
                  <td className="mono">{l.heatNo ?? '—'}</td>
                  {isCoil ? <td>{l.parentSlab ? <LotLink lotNo={l.parentSlab.lotNo} /> : '—'}</td> : null}
                  <td className="num">{fmtTon(unitWeight)}</td>
                  <td className="tnum">{fmtDate(l.producedAt)}</td>
                </tr>
              ))}
              {!s.lots.length ? <tr><td colSpan={isCoil ? 6 : 5} className="hl-muted">출고 LOT이 없어요</td></tr> : null}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td colSpan={isCoil ? 3 : 2}>합계 {s.qty}{s.qtyUnit}</td>
                <td className="num">{fmtTon(s.weightTon)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="hl-col" style={{ gap: 6 }}>
        <b style={{ fontSize: 12.5 }}>2. 화학성분 (히트 성분 검사)</b>
        <InspectionMatrix headLabel="히트" rows={heatRows} emptyText="히트 성분 검사값이 없어요" />
      </div>

      <div className="hl-col" style={{ gap: 6 }}>
        <b style={{ fontSize: 12.5 }}>3. 제품 검사{lotProcess ? ` (${processLabel(lotProcess)})` : ''}</b>
        <InspectionMatrix headLabel="No" rows={lotRows} emptyText="제품 검사값이 없어요" />
      </div>

      {slabRows.length ? (
        <div className="hl-col" style={{ gap: 6 }}>
          <b style={{ fontSize: 12.5 }}>4. 압연 전 슬래브 검사</b>
          <InspectionMatrix headLabel="슬래브 LOT" rows={slabRows} emptyText="슬래브 검사값이 없어요" />
        </div>
      ) : null}

      <div className="hl-row" style={{ gap: 16, alignItems: 'stretch' }}>
        <div className="hl-row" style={{ gap: 0, border: LINE, fontSize: 12, flex: 1, alignSelf: 'center' }}>
          <span style={{ ...cellTh, borderRight: LINE }}>출하</span>
          <span className="mono" style={{ padding: '6px 12px', flex: 1 }}>{s.shipment.shipmentRequestNo}</span>
          <span style={{ ...cellTh, borderLeft: LINE, borderRight: LINE }}>출고</span>
          <span style={{ padding: '6px 12px', flex: 1 }}><span className="mono">{s.shipment.goodsIssueNo}</span> · <span className="tnum">{fmtDateTime(s.shipment.goodsIssuedAt)}</span></span>
        </div>
        <div className="hl-col" style={{ alignItems: 'center', justifyContent: 'center', gap: 2, width: 180, border: `2px solid ${verdictColor}`, color: verdictColor, padding: '6px 10px' }}>
          <span style={{ fontSize: 11, letterSpacing: '.1em' }}>종합 판정</span>
          <b style={{ fontSize: 20, letterSpacing: '.3em', lineHeight: '26px' }}>{pass ? '합격' : fail ? '불합격' : '—'}</b>
        </div>
      </div>

      <div className="hl-row" style={{ gap: 12, paddingTop: 10, borderTop: LINE, marginTop: 'auto', fontSize: 12, flexWrap: 'wrap' }}>
        <span className="hl-ink2">위 제품은 해당 규격에 따라 제조·검사되었음을 증명합니다.</span>
        <span className="hl-muted" style={{ marginLeft: 'auto' }}>출고 확정 때 자동 발행 · 발행 시점 스냅샷 ({fmtDateTime(s.issuedAt)})</span>
      </div>
    </article>
  );
}
