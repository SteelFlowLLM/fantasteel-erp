// 검사 입력·불합격 관리가 나눠 쓰는 화면 부품.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { INSPECTION_RESULT_LABEL, LOT_STATUS_LABEL, DISPOSITION_STATUS_LABEL, type DispositionStatus } from '@fantasteel/shared';
import type { BusinessEventView } from '@/api/businessEvents';
import type { InspectionLot, InspectionValue } from '@/api/quality';
import { Badge, EmptyNote } from '@/components/ui';
import { fmtMDHM } from '@/lib/format';
import { gaugeGeometry, limitText, trimNum } from './qualityUtil';
import './quality.css';

export const traceHref = (lotNo: string, direction?: 'forward' | 'backward') =>
  `/lots/trace?lot=${encodeURIComponent(lotNo)}${direction ? `&direction=${direction}` : ''}`;

export function ResultBadge({ result }: { result: 'PASS' | 'FAIL' }) {
  return <Badge tone={result === 'PASS' ? 'ok' : 'danger'}>{INSPECTION_RESULT_LABEL[result]}</Badge>;
}

/** 불합격 처리 상태: 보류 / 격하 / 폐기 / 미지정 */
export function DispositionBadge({ status }: { status: DispositionStatus | null }) {
  if (status === 'HOLD') return <Badge tone="wait">{DISPOSITION_STATUS_LABEL.HOLD}</Badge>;
  if (status === 'SCRAPPED') return <Badge tone="danger">{DISPOSITION_STATUS_LABEL.SCRAPPED}</Badge>;
  if (status === 'DOWNGRADED') return <span className="hl-badge hl-badge--outline">{DISPOSITION_STATUS_LABEL.DOWNGRADED}</span>;
  return <Badge>미지정</Badge>;
}

/** 측정값을 기준 구간 위에 놓아 보여 주는 게이지 (B안 hl-gauge). value가 없으면 기준 구간만. */
export function LimitGauge({ minValue, maxValue, unit, raw, value, bad }: { minValue: string | null; maxValue: string | null; unit?: string | null; raw?: string; value: number | null; bad?: boolean }) {
  const g = gaugeGeometry({ minValue, maxValue }, value);
  if (!g) return <span className="hl-cap">기준이 없어 게이지를 그릴 수 없어요</span>;
  const tone = bad ? 'is-bad' : 'is-ok';
  return (
    <div className="qc-gauge">
      <div className="hl-gauge" role="img" aria-label={`기준 ${limitText({ minValue, maxValue, unit: unit ?? null })}${raw ? `, 측정값 ${raw}` : ''}`}>
        <div className="hl-gauge__track">
          <div className="hl-gauge__range" style={{ left: `${g.from}%`, width: `${Math.max(0, g.to - g.from)}%` }} />
        </div>
        {minValue !== null ? <span className="hl-gauge__lbl" style={{ left: `${g.from}%` }}>{trimNum(minValue)}</span> : null}
        {maxValue !== null ? <span className="hl-gauge__lbl" style={{ left: `${g.to}%` }}>{trimNum(maxValue)}</span> : null}
        {g.mark !== null ? (
          <>
            <span className={`hl-gauge__mark ${tone}`} style={{ left: `${g.mark}%` }} />
            <span className={`hl-gauge__lbl hl-gauge__lbl--b ${tone}`} style={{ left: `${g.mark}%` }}>{raw}{unit ? ` ${unit}` : ''}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** 표 안에 넣는 작은 게이지 */
export function MiniGauge({ minValue, maxValue, value, bad }: { minValue: string | null; maxValue: string | null; value: number | null; bad?: boolean }) {
  const g = gaugeGeometry({ minValue, maxValue }, value);
  if (!g) return <span className="hl-cap">—</span>;
  return (
    <div className="qc-mini" aria-hidden="true">
      <div className="qc-mini__range" style={{ left: `${g.from}%`, width: `${Math.max(0, g.to - g.from)}%` }} />
      {g.mark !== null ? <div className={`qc-mini__dot${bad ? ' is-bad' : ''}`} style={{ left: `${g.mark}%` }} /> : null}
    </div>
  );
}

/** LOT 정보: 강종·규격, 상위 히트, 생산계획, 수주 (모두 링크) */
export function LotInfoCard({ lot, inspectionName, extra }: { lot: InspectionLot; inspectionName?: string; extra?: ReactNode }) {
  return (
    <section className="hl-card">
      <div className="hl-card__body" style={{ padding: '12px 16px' }}>
        <dl className="qc-kv">
          <div className="qc-kv__item"><dt>강종 · 규격</dt><dd>{lot.steelGradeCode ? <span className="mono">{lot.steelGradeCode}</span> : '—'} {lot.specCode ? <span className="mono">{lot.specCode}</span> : null}</dd></div>
          {inspectionName ? <div className="qc-kv__item"><dt>검사</dt><dd>{inspectionName}</dd></div> : null}
          <div className="qc-kv__item"><dt>LOT 상태</dt><dd>{LOT_STATUS_LABEL[lot.lotStatus]}</dd></div>
          <div className="qc-kv__item"><dt>생산 시각</dt><dd className="qc-num">{fmtMDHM(lot.producedAt)}</dd></div>
          {lot.lotType !== 'HEAT' ? (
            <div className="qc-kv__item">
              <dt>상위 히트 성분 검사</dt>
              <dd>
                {lot.heatLotNo ? <Link className="hl-link-id mono" to={traceHref(lot.heatLotNo)}>{lot.heatLotNo}</Link> : '—'}{' '}
                {lot.heatIsPassed === null ? <Badge>판정 전</Badge> : <ResultBadge result={lot.heatIsPassed ? 'PASS' : 'FAIL'} />}
              </dd>
            </div>
          ) : null}
          <div className="qc-kv__item"><dt>생산계획</dt><dd>{lot.productionPlanId ? <Link className="hl-link-id mono" to={`/production/plans?plan=${lot.productionPlanId}`}>{lot.productionPlanNo}</Link> : <span className="hl-muted">없음</span>}</dd></div>
          <div className="qc-kv__item">
            <dt>수주</dt>
            <dd>{lot.salesOrderId ? <><Link className="hl-link-id mono" to={`/sales-orders/${lot.salesOrderId}`}>{lot.salesOrderNo}</Link> <span className="hl-cap">{lot.customerName}</span></> : <span className="hl-muted">없음</span>}</dd>
          </div>
          {extra}
        </dl>
      </div>
    </section>
  );
}

/** 등록된 검사값 표: 기준·측정값·항목별 판정. 불합격 항목은 붉게 강조한다. */
export function InspectionValuesTable({ values }: { values: InspectionValue[] }) {
  if (!values.length) return <EmptyNote>검사값이 없어요</EmptyNote>;
  return (
    <div className="qc-wrap">
      <table className="hl-table">
        <thead><tr><th>항목</th><th>기준</th><th className="num">측정값</th><th>판정</th><th>기준 안 위치</th></tr></thead>
        <tbody>
          {[...values].sort((a, b) => a.sortOrder - b.sortOrder).map((v) => {
            const bad = v.isPassed === false;
            const value = v.measuredValue === null ? null : Number(v.measuredValue);
            return (
              <tr key={v.inspectionItemCode} className={bad ? 'is-risk' : undefined}>
                <td>{bad ? <b>{v.inspectionItemName}</b> : v.inspectionItemName}</td>
                <td className="qc-num">{limitText(v)}</td>
                <td className={`num${bad ? ' hl-danger-text' : ''}`} style={bad ? { fontWeight: 600 } : undefined}>
                  {v.measuredValue === null ? '—' : `${trimNum(v.measuredValue)}${v.unit ? ` ${v.unit}` : ''}`}
                </td>
                <td>{v.isPassed === null ? <Badge>미입력</Badge> : <ResultBadge result={v.isPassed ? 'PASS' : 'FAIL'} />}</td>
                <td><MiniGauge minValue={v.minValue} maxValue={v.maxValue} value={value} bad={bad} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const dotTone = (t: string) =>
  t === 'REJECTED_JUDGED' ? 'danger' : t === 'AUTO_RESERVED' || t === 'DISPOSITION_SET' ? 'ok' : t === 'ALLOCATION_RELEASED' ? 'wait' : t === 'INSPECTION_REGISTERED' ? 'run' : '';

/** 작업 로그 이벤트 타임라인 (LOT 이력·검사 뒤 처리) */
export function EventTimeline({ events }: { events: BusinessEventView[] }) {
  return (
    <div className="hl-timeline">
      {events.map((e) => (
        <div key={e.id} className="hl-tl" style={{ paddingBottom: 10 }}>
          <span className={`hl-tl__dot${dotTone(e.eventType) ? ` hl-tl__dot--${dotTone(e.eventType)}` : ''}`} />
          <div className="hl-tl__body">
            <div className="hl-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className={`hl-actor hl-actor--${e.actorType === 'USER' ? 'user' : 'system'}`}>{e.actorType === 'USER' ? e.actorLabel : '시스템'}</span>
              <span className="hl-evt">{e.eventTypeLabel}</span>
              <span>{e.summary}</span>
            </div>
            <time>{fmtMDHM(e.occurredAt)}</time>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 상세 위쪽: 빵부스러기 · LOT 번호(추적 링크) · 종류 · 상태 배지 · 오른쪽 버튼들 */
export function LotHeader({ area, lotNo, typeName, badges, actions }: { area: string; lotNo: string; typeName: string; badges?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="hl-row" style={{ gap: 10, flex: 'none', flexWrap: 'wrap' }}>
      <div className="hl-col" style={{ gap: 2 }}>
        <div className="hl-crumb">
          품질
          <i className="ic ic-chevron-right ic--sm" />
          {area}
          <i className="ic ic-chevron-right ic--sm" />
          {typeName}
        </div>
        <div className="hl-row" style={{ gap: 10 }}>
          <Link className="mono hl-link-id" to={traceHref(lotNo)} style={{ fontSize: 18, fontWeight: 600, lineHeight: '26px' }}>{lotNo}</Link>
          <span className="hl-tag">{typeName}</span>
          {badges}
        </div>
      </div>
      <div className="hl-row" style={{ marginLeft: 'auto', gap: 8, flexWrap: 'wrap' }}>{actions}</div>
    </div>
  );
}
