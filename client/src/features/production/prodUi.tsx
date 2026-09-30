// 생산 화면(생산계획·공정 실적·열연 투입)이 같이 쓰는 작은 부품. 모양은 B안 디자인(hl-*) 그대로.
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import {
  DISPOSITION_STATUS_LABEL, INSPECTION_RESULT_LABEL, ITEM_QTY_UNIT, ITEM_TYPE_LABEL, LOT_STATUS_LABEL, PROCESS_CODE_LABEL, PROCESS_ORDER, PRODUCTION_PLAN_STATUS_LABEL,
  PRODUCTION_RESULT_STATUS_LABEL, type ProcessCode, type ProductionPlanStatus, type ProductionResultStatus,
} from '@fantasteel/shared';
import { ApiError } from '@/api/client';
import type { PlanLotView, PlanProgress, PlanSummary, SpecView } from '@/api/production';
import { Badge, Icon, type Tone } from '@/components/ui';
import { dLabel, fmtDims, fmtMD } from '@/lib/format';

export const PLAN_TONE: Record<ProductionPlanStatus, Tone> = { PLANNED: 'wait', CONFIRMED: 'run', IN_PROGRESS: 'run', COMPLETED: 'ok', CANCELLED: 'neutral' };
export const RESULT_TONE: Record<ProductionResultStatus, Tone> = { READY: 'wait', STARTED: 'run', COMPLETED: 'ok' };

/** 목록 구분 제목 (v1 B안의 GROUP 스타일) */
export const GROUP_STYLE: CSSProperties = { padding: '8px 16px 4px', fontSize: '11px', fontWeight: 600, color: 'var(--ink-3)', background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' };

export const qtyUnit = (itemType: 'SLAB' | 'COIL') => ITEM_QTY_UNIT[itemType];
/** "SM355 250 × 1,500 × 10,000" */
export const specText = (s: SpecView) => `${s.steelGradeCode} ${fmtDims(s.thicknessMm, s.widthMm, s.lengthMm)}`;
/** 수율 문자열 "0.9377" → "93.77%" (서버 값을 그대로 백분율로만 바꾼다) */
export function fmtRate(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v) * 100;
  return Number.isNaN(n) ? '-' : `${Number(n.toFixed(4))}%`;
}
export const lotTraceTo = (lotNo: string) => `/lots/trace?lot=${encodeURIComponent(lotNo)}`;

export function PlanStatusBadge({ status, style }: { status: ProductionPlanStatus; style?: CSSProperties }) {
  return <span style={style}><Badge tone={PLAN_TONE[status]}>{PRODUCTION_PLAN_STATUS_LABEL[status]}</Badge></span>;
}
export function ResultStatusBadge({ status }: { status: ProductionResultStatus }) {
  return <Badge tone={RESULT_TONE[status]}>{PRODUCTION_RESULT_STATUS_LABEL[status]}</Badge>;
}

export function LotLink({ lotNo }: { lotNo: string }) {
  return <Link className="hl-link-id" to={lotTraceTo(lotNo)}>{lotNo}</Link>;
}

/** 검사 상태: 자기 검사 + 상위 히트 성분 검사 */
export function LotJudgeBadge({ isPassed, heatIsPassed, lotType }: { isPassed: boolean | null; heatIsPassed?: boolean | null; lotType: string }) {
  if (lotType === 'HOT_METAL') return <span className="hl-muted">검사 없음</span>;
  if (isPassed === false) return <Badge tone="danger">{INSPECTION_RESULT_LABEL.FAIL}</Badge>;
  if (heatIsPassed === false) return <Badge tone="danger" title="상위 히트의 성분 검사가 불합격이에요">히트 {INSPECTION_RESULT_LABEL.FAIL}</Badge>;
  if (isPassed === null) return <Badge tone="wait">{INSPECTION_RESULT_LABEL.PENDING}</Badge>;
  if (lotType !== 'HEAT' && heatIsPassed === null) return <Badge tone="wait" title="자기 검사는 합격했지만 상위 히트의 성분 검사가 아직이에요">히트 {INSPECTION_RESULT_LABEL.PENDING}</Badge>;
  return <Badge tone="ok">{INSPECTION_RESULT_LABEL.PASS}</Badge>;
}

export function lotStateText(lot: PlanLotView): string {
  if (lot.dispositionStatus) return DISPOSITION_STATUS_LABEL[lot.dispositionStatus];
  if (lot.lotStatus !== 'IN_STOCK') return LOT_STATUS_LABEL[lot.lotStatus];
  if (lot.confirmedAllocationId !== null) return '배정 확정';
  if (lot.isEarmarked) return '열연 투입용 귀속';
  return LOT_STATUS_LABEL.IN_STOCK;
}

export type StepState = 'done' | 'run' | 'todo';
/** 디자인의 단계 표시: <div class="hl-steps"> */
export function Steps({ steps, style }: { steps: { label: ReactNode; state: StepState }[]; style?: CSSProperties }) {
  return (
    <div className="hl-steps" style={{ overflowX: 'auto', ...style }}>
      {steps.map((s, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 ? <span className={`hl-step__line${s.state !== 'todo' ? ' is-done' : ''}`} /> : null}
          <span className={`hl-step${s.state === 'done' ? ' is-done' : s.state === 'run' ? ' is-run' : ''}`}>
            <span className="hl-step__dot">{s.state === 'done' ? <i className="ic ic-check ic--sm" style={{ width: '10px', height: '10px' }} aria-hidden="true" /> : null}</span>
            {s.label}
          </span>
        </span>
      ))}
    </div>
  );
}

/** 계획의 공정 순서: 제선 → 제강 → 연주 → [열연] */
export const planProcesses = (itemType: 'SLAB' | 'COIL'): ProcessCode[] => PROCESS_ORDER.filter((p) => p !== 'HOT_ROLLING' || itemType === 'COIL');

export function progressState(p: PlanProgress | undefined): StepState {
  if (!p || p.totalCount === 0) return 'todo';
  if (p.completedCount >= p.totalCount) return 'done';
  return p.startedCount > 0 || p.completedCount > 0 ? 'run' : 'todo';
}

/** 편성 → 제선 → 제강 → 연주 → [열연] 진행 표시. 숫자는 서버의 progress 그대로 (완료 실적 수 / 실적 수). */
export function PlanProcessSteps({ plan }: { plan: PlanSummary }) {
  const planned = plan.productionPlanStatus !== 'PLANNED' && plan.productionPlanStatus !== 'CANCELLED';
  const steps: { label: ReactNode; state: StepState }[] = [
    { label: plan.heatCount > 0 ? `히트 편성 · ${plan.heatCount}히트` : '히트 편성', state: planned || plan.confirmedAt ? 'done' : plan.productionPlanStatus === 'PLANNED' ? 'run' : 'todo' },
    ...planProcesses(plan.itemType).map((code) => {
      const p = plan.progress.find((x) => x.processCode === code);
      return { label: p ? `${PROCESS_CODE_LABEL[code]} ${p.completedCount}/${p.totalCount}` : PROCESS_CODE_LABEL[code], state: progressState(p) };
    }),
  ];
  return <Steps steps={steps} />;
}

/** 목록(왼쪽)의 생산계획 한 줄 */
export function PlanListItem({ plan, active, onPick, extra }: { plan: PlanSummary; active: boolean; onPick: (id: number) => void; extra?: ReactNode }) {
  const so = plan.salesOrder;
  const late = so ? dLabel(so.dueDate).startsWith('D+') : false;
  const open = plan.productionPlanStatus !== 'COMPLETED' && plan.productionPlanStatus !== 'CANCELLED';
  return (
    <div
      className={`hl-mitem${active ? ' is-active' : ''}`}
      role="button"
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      onClick={() => onPick(plan.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick(plan.id);
        }
      }}
    >
      <div className="hl-row">
        <span className="hl-link-id" style={active ? { fontWeight: 600 } : undefined}>{plan.productionPlanNo}</span>
        <span className="hl-tag">{ITEM_TYPE_LABEL[plan.itemType]}</span>
        {plan.isReproduction ? <Badge tone="wait">재생산</Badge> : null}
        <PlanStatusBadge status={plan.productionPlanStatus} style={{ marginLeft: 'auto' }} />
      </div>
      <div className="hl-row" style={{ fontSize: '12px' }}>
        {so ? (
          <>
            <span className="mono">{so.salesOrderNo}</span>
            <span className="hl-muted">·</span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{so.customerName}</span>
          </>
        ) : (
          <span className="hl-muted">수주 연결 없음 (여재)</span>
        )}
        <b className="tnum" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>부족 {plan.shortageQty}{qtyUnit(plan.itemType)}</b>
      </div>
      <div className="hl-row hl-cap">
        <span className="mono">{specText(plan.productSpec)}</span>
        <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{plan.heatCount > 0 ? `히트 ${plan.heatCount}개` : plan.productionPlanStatus === 'PLANNED' ? '편성 전' : '히트 없음'}</span>
      </div>
      {so ? (
        <div className="hl-row hl-cap">
          <span className={late && open ? 'hl-risk' : undefined}>납기 {fmtMD(so.dueDate)}{open ? ` · ${dLabel(so.dueDate)}` : ''}</span>
          {plan.needsAction ? <span className="hl-wait-text" style={{ marginLeft: 'auto' }}>조치 필요</span> : null}
        </div>
      ) : null}
      {extra}
    </div>
  );
}

/** 서버 오류를 그대로 크게 보여 준다. 원료 부족(409)이면 MRP·구매요청으로 가는 링크를 붙인다. */
export function ServerErrorBanner({ error, purchaseLinks }: { error: unknown; purchaseLinks?: boolean }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다';
  const code = error instanceof ApiError ? error.code : null;
  const showLinks = purchaseLinks ?? (error instanceof ApiError && error.status === 409);
  return (
    <div className="hl-banner hl-banner--danger" role="alert" style={{ alignItems: 'flex-start' }}>
      <Icon name="alert" />
      <div className="hl-col" style={{ gap: 6, minWidth: 0 }}>
        <b style={{ wordBreak: 'keep-all' }}>{message}</b>
        {code ? <span className="mono" style={{ fontSize: '11px' }}>{code}</span> : null}
        {showLinks ? (
          <div className="hl-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Link className="hl-btn hl-btn--sm" to="/mrp"><Icon name="calc" />MRP에서 소요량 보기</Link>
            <Link className="hl-btn hl-btn--sm" to="/purchase-requisitions"><Icon name="cart" />구매요청으로 가기</Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function LockHint({ children }: { children: ReactNode }) {
  return <span className="hl-lockhint"><Icon name="lock" size="sm" />{children}</span>;
}
