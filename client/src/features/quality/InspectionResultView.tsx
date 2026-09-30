// 등록된 검사 1건을 읽기 전용으로 보여 준다. fresh면 "방금 등록" — 시스템 판정과 그 뒤에 일어난 일을 보여 주고 다음 LOT으로 넘어가게 한다.
import { Link } from 'react-router';
import type { Inspection } from '@/api/quality';
import { Badge, Icon, Spinner } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { useAfterInspectionEvents } from './qualityHooks';
import { EventTimeline, InspectionValuesTable } from './qualityUi';
import './quality.css';

/** 판정 뒤 재고 쪽 규칙 (docs/api/quality.md POST /quality-inspections) */
function stockNote(i: Inspection): string {
  const { lot } = i;
  if (i.inspectionResult === 'FAIL') {
    return lot.lotType === 'HEAT'
      ? '재고에 들어가지 않아요. 하위 슬래브·코일도 쓸 수 없고, 하위 LOT에 걸려 있던 배정은 해제돼요.'
      : '재고에 들어가지 않아요. 예약·배정·출고 대상에서 빠져요.';
  }
  if (lot.lotType === 'HEAT') return '성분 합격이에요. 이미 제품 검사에 합격해 있던 하위 슬래브·코일이 재고에 들어가요.';
  if (lot.heatIsPassed === true) return '재고에 들어가요. 원래 수주 품목의 미확보 매수 안에서 자동 예약돼요.';
  return '상위 히트 성분 검사가 아직 합격이 아니어서 재고에는 히트가 합격한 뒤에 들어가요.';
}

function AfterCard({ inspection }: { inspection: Inspection }) {
  const { events, isLoading } = useAfterInspectionEvents(inspection);
  const fail = inspection.inspectionResult === 'FAIL';
  return (
    <section className="hl-card">
      <header className="hl-card__head">
        <h2>판정 뒤 처리</h2>
        <span className="hl-card__meta">시스템이 같이 처리한 일 · 작업 로그 기준</span>
        <div className="hl-card__actions"><Link className="hl-cap" to="/business-events" style={{ color: '#1F5FCC' }}>작업 로그</Link></div>
      </header>
      <div className="hl-card__body" style={{ gap: 10 }}>
        <div className={`hl-banner ${fail ? 'hl-banner--danger' : 'hl-banner--ok'}`} style={{ fontSize: 12, lineHeight: '17px' }}>
          <Icon name={fail ? 'x-circle' : 'check-circle'} size="sm" />
          <span>{stockNote(inspection)}</span>
        </div>
        {isLoading ? <Spinner /> : events.length ? <EventTimeline events={events} /> : <span className="hl-cap">이 검사와 함께 기록된 후속 처리가 없어요 (자동 예약 대상이 아니면 기록되지 않아요)</span>}
        <div className="hl-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {fail ? <Link className="hl-btn hl-btn--sm" to={`/quality/rejected?lot=${inspection.lot.id}`}><Icon name="quality" />불합격 관리에서 처리 상태 지정</Link> : null}
          {fail && inspection.lot.productionPlanId ? <Link className="hl-btn hl-btn--sm" to={`/production/plans?plan=${inspection.lot.productionPlanId}`}><Icon name="calendar" />생산계획 ({inspection.lot.productionPlanNo})</Link> : null}
          {!fail && inspection.lot.salesOrderId ? <Link className="hl-btn hl-btn--sm" to={`/sales-orders/${inspection.lot.salesOrderId}`}><Icon name="order" />수주 {inspection.lot.salesOrderNo}</Link> : null}
        </div>
      </div>
    </section>
  );
}

export function InspectionResultView({ inspection, fresh, remaining, onNext }: { inspection: Inspection; fresh?: boolean; remaining?: number; onNext?: () => void }) {
  const pass = inspection.inspectionResult === 'PASS';
  const failed = inspection.values.filter((v) => v.isPassed === false);
  return (
    <>
      <section className="hl-card" style={{ flex: 'none' }}>
        <div className="hl-card__body" style={{ padding: '12px 16px' }}>
          <div className="qc-lead">
            <div className={`qc-verdict ${pass ? 'is-pass' : 'is-fail'}`}>
              <Icon name={pass ? 'check-circle' : 'x-circle'} size="lg" />
              <div className="hl-col">
                <span className="hl-cap">{fresh ? '시스템 판정' : '판정'}</span>
                <b>{pass ? '합격' : '불합격'} <small style={{ fontSize: 12, fontWeight: 500 }}>{failed.length ? `기준 밖 ${failed.length}개` : '전 항목 기준 안'}</small></b>
              </div>
            </div>
            <div className="hl-col" style={{ gap: 3, minWidth: 0 }}>
              <div className="hl-row" style={{ gap: 6 }}>
                <span className="mono" style={{ fontWeight: 600 }}>{inspection.qualityInspectionNo}</span>
                <Badge>{inspection.inspectionName}</Badge>
                {fresh ? <Badge tone="run">방금 등록</Badge> : null}
              </div>
              <span className="hl-cap">{fmtDateTime(inspection.inspectedAt)} · 검사자 {inspection.inspectorEmployeeName ?? '시스템'}</span>
            </div>
            {fresh && onNext ? (
              <div className="hl-row" style={{ marginLeft: 'auto', gap: 8 }}>
                <button type="button" className="hl-btn hl-btn--primary" onClick={onNext}>
                  {remaining ? <>다음 LOT 검사 <span className="hl-cap" style={{ color: 'inherit', opacity: 0.85 }}>남은 {remaining}건</span></> : '대기열로 돌아가기'}
                  <Icon name="arrow-right" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="hl-card">
        <header className="hl-card__head">
          <h2>검사값</h2>
          <span className="hl-card__meta">판정에 쓴 기준과 함께 저장된 값 · 읽기 전용</span>
        </header>
        <div className="hl-card__body hl-card__body--flush">
          <InspectionValuesTable values={inspection.values} />
        </div>
        {inspection.memo ? (
          <div className="hl-card__foot" style={{ alignItems: 'flex-start' }}>
            <span className="hl-cap">메모</span><span style={{ fontSize: 13 }}>{inspection.memo}</span>
          </div>
        ) : null}
      </section>

      <AfterCard inspection={inspection} />
    </>
  );
}
