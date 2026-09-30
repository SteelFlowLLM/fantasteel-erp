// 생산계획 화면의 모달: 실적 시뮬레이션(REQ-PRD-007) · 재생산 계획(REQ-PRD-006) · 계획 취소.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { PROCESS_CODE_LABEL, PRODUCTION_PLAN_STATUS_LABEL, SALES_ORDER_ITEM_STATUS_LABEL, calcWeightTon, type SalesOrderItemStatus } from '@fantasteel/shared';
import { productionApi, type PlanDetail, type PlanSummary, type ReproductionResult, type SimulateBody, type SimulateResult, type SimulateStep } from '@/api/production';
import { Badge, EmptyNote, Field, Icon, Modal, QueryBoundary, SoonButton } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { fmtTon } from '@/lib/format';
import { canUse, useMe } from '@/stores/auth';
import { PLAN_TOPICS } from './productionHooks';
import { LotLink, ServerErrorBanner, fmtRate, qtyUnit, specText } from './prodUi';

const SEED_MAX = 2_147_483_647;
const STEP_KIND_LABEL: Record<SimulateStep['kind'], string> = { RESULT: '공정 실적', INSPECTION: '검사 자동 등록', ALLOCATION: '열연 투입 배정' };
const SIM_TOPICS = [...PLAN_TOPICS, 'quality-inspections', 'sales-orders', 'business-events'];

function stepSummary(s: SimulateStep): string {
  if (s.kind === 'INSPECTION') return s.outputQty !== null ? `검사 ${s.outputQty}건` : '-';
  if (s.kind === 'ALLOCATION') return `필요 ${s.plannedQty ?? '-'}매 · 배정 ${s.outputQty ?? '-'}매`;
  if (s.processCode === 'CASTING') return `계획 ${s.plannedQty ?? '-'}매 → 산출 ${s.outputQty ?? '-'}매${s.lossQty ? ` (손실 ${s.lossQty}매)` : ''}`;
  if (s.processCode === 'HOT_ROLLING') return `계획 ${s.plannedQty ?? '-'}매 → 코일 ${s.outputQty ?? '-'}개`;
  return s.lotNos.length ? `LOT ${s.lotNos.length}개` : '-';
}

function LotNoList({ lotNos }: { lotNos: string[] }) {
  if (!lotNos.length) return <span className="hl-muted">-</span>;
  const shown = lotNos.slice(0, 3);
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {shown.map((no) => <LotLink key={no} lotNo={no} />)}
      {lotNos.length > shown.length ? <span className="hl-muted">외 {lotNos.length - shown.length}</span> : null}
    </span>
  );
}

/** 실적 시뮬레이션 실행 (시드·시연용) */
export function SimulateModal({ plan, onClose }: { plan: PlanSummary; onClose: () => void }) {
  const me = useMe();
  const allowed = canUse(me, 'RESULT_CONFIRM');
  const [seedText, setSeedText] = useState('');
  const [includeInspection, setIncludeInspection] = useState(true);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const run = useAction(productionApi.simulate, {
    success: '실적 시뮬레이션을 실행했어요',
    invalidate: SIM_TOPICS,
    onSuccess: (r) => { setResult(r); setError(null); },
    onError: (e) => setError(e),
  });

  const seedTrim = seedText.trim();
  const seedNum = seedTrim === '' ? undefined : /^\d+$/.test(seedTrim) ? Number(seedTrim) : NaN;
  const seedError = seedNum !== undefined && (Number.isNaN(seedNum) || seedNum > SEED_MAX) ? `0 ~ ${SEED_MAX.toLocaleString('en-US')} 사이의 정수로 입력해 주세요` : null;
  const submit = () => {
    const body: SimulateBody = { includeInspection };
    if (seedNum !== undefined) body.seed = seedNum;
    setError(null);
    run.mutate({ id: plan.id, body });
  };

  if (result) {
    const lossTotal = result.steps.reduce((s, x) => s + (x.kind === 'RESULT' && x.processCode === 'CASTING' ? x.lossQty ?? 0 : 0), 0);
    const lotTotal = result.steps.reduce((s, x) => s + (x.kind === 'RESULT' ? x.lotNos.length : 0), 0);
    return (
      <Modal
        title={<>실적 시뮬레이션 결과 · <span className="mono">{plan.productionPlanNo}</span></>}
        onClose={onClose}
        width={760}
        footer={(
          <>
            <Link className="hl-btn" to={`/production/results?plan=${plan.id}`}><Icon name="factory" />공정 실적 보기</Link>
            <button type="button" className="hl-btn hl-btn--primary" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
          </>
        )}
      >
        <div className="hl-col" style={{ gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
            <div className="hl-figure"><span>난수 시드</span><b className="mono" style={{ fontSize: '15px' }}>{result.seed}</b></div>
            <div className="hl-figure"><span>연주 손실률 (0~5%)</span><b style={{ fontSize: '15px' }}>{result.sampledLossRate === null ? '연주 안 함' : fmtRate(result.sampledLossRate)}</b></div>
            <div className="hl-figure"><span>연주 손실</span><b style={{ fontSize: '15px' }}>{lossTotal}매</b></div>
            <div className="hl-figure"><span>만든 LOT</span><b style={{ fontSize: '15px' }}>{lotTotal}개</b></div>
            <div className="hl-figure"><span>계획 상태</span><b style={{ fontSize: '15px' }}>{PRODUCTION_PLAN_STATUS_LABEL[result.plan.productionPlanStatus]}</b></div>
          </div>
          {result.notes.map((n, i) => (
            <div key={i} className="hl-banner hl-banner--wait"><Icon name="info" /><span>{n}</span></div>
          ))}
          <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
            <table className="hl-table hl-table--compact">
              <thead>
                <tr><th>순서</th><th>한 일</th><th>공정</th><th>내용</th><th>LOT</th></tr>
              </thead>
              <tbody>
                {result.steps.map((s, i) => (
                  <tr key={i}>
                    <td className="tnum">{i + 1}</td>
                    <td><Badge tone={s.kind === 'RESULT' ? 'run' : s.kind === 'INSPECTION' ? 'ok' : 'wait'}>{STEP_KIND_LABEL[s.kind]}</Badge></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{PROCESS_CODE_LABEL[s.processCode]}{s.heatSeq !== null ? ` · 히트 ${s.heatSeq}` : ''}</td>
                    <td>{stepSummary(s)}</td>
                    <td><LotNoList lotNos={s.lotNos} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!result.steps.length ? <EmptyNote>이번 실행에서 진행한 공정이 없어요 (이미 끝난 계획이에요)</EmptyNote> : null}
          </div>
          <span className="hl-cap">실적은 SYSTEM이 등록한 것으로 기록돼요 (시뮬레이션 표시). {result.includeInspection ? '검사도 기준 안쪽 값으로 자동 등록했어요.' : '검사는 등록하지 않아 검사 대기로 남아 있어요.'}</span>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={<>실적 시뮬레이션 실행 · <span className="mono">{plan.productionPlanNo}</span></>}
      onClose={onClose}
      width={560}
      footer={(
        <>
          <button type="button" className="hl-btn" onClick={onClose}>취소</button>
          <button type="button" className="hl-btn hl-btn--primary" style={{ marginLeft: 'auto' }} disabled={!allowed || !!seedError || run.isPending} title={allowed ? undefined : '권한이 필요해요'} onClick={submit}>
            <Icon name="flow" />{run.isPending ? '실행 중…' : '실행'}
          </button>
        </>
      )}
    >
      <div className="hl-col" style={{ gap: 14 }}>
        <div className="hl-banner hl-banner--run">
          <Icon name="info" />
          <span>
            <b>시드·시연용 기능이에요.</b> 이 계획의 남은 공정 실적을 끝까지 만들어요. 계획 수율은 고정이고, 연주 단계에서만 0~5% 손실을 슬래브 매수 감소로 반영해요 (열연은 추가 손실 없음).
            {plan.itemType === 'COIL' ? ' 코일 계획은 필요한 슬래브만 FIFO로 배정해 열연해요.' : ''}
          </span>
        </div>
        {error ? <ServerErrorBanner error={error} /> : null}
        <Field label="난수 시드 (선택)" hint="같은 시드면 같은 손실률이 나와요. 비우면 서버가 정해서 결과에 알려 줘요." error={seedError}>
          <input className={`hl-input tnum${seedError ? ' is-error' : ''}`} type="text" inputMode="numeric" placeholder="예: 20260930" value={seedText} onChange={(e) => setSeedText(e.target.value)} />
        </Field>
        <label className="hl-row" style={{ gap: 8, fontSize: '13px', cursor: 'pointer' }}>
          <input type="checkbox" checked={includeInspection} onChange={(e) => setIncludeInspection(e.target.checked)} />
          <span>검사 포함 <span className="hl-muted">— 성분·슬래브·코일 검사를 기준 안쪽 값으로 자동 등록</span></span>
        </label>
        {!includeInspection ? <span className="hl-cap">검사를 빼면 LOT이 검사 대기로 남아요.{plan.itemType === 'COIL' ? ' 코일 계획은 합격 슬래브가 없어 열연까지 진행하지 않아요.' : ''}</span> : null}
        <span className="hl-cap">원료가 부족하면 아무것도 바꾸지 않고 어떤 원료가 몇 톤 모자란지 알려 줘요.</span>
      </div>
    </Modal>
  );
}

const itemStatusLabel = (s: string) => SALES_ORDER_ITEM_STATUS_LABEL[s as SalesOrderItemStatus] ?? s;

/** 재생산 계획: 필요 매수·가용 재고·여재를 확인하고 만든다. 매수는 서버가 계산한다. */
export function ReproductionModal({ salesOrderItemId, onClose, onCreated }: { salesOrderItemId: number; onClose: () => void; onCreated: (r: ReproductionResult) => void }) {
  const me = useMe();
  const allowed = canUse(me, 'PLAN_CONFIRM');
  const [reason, setReason] = useState('');
  const preview = useQuery({ queryKey: ['production-plans', 'reproduction-preview', salesOrderItemId], queryFn: () => productionApi.reproductionPreview(salesOrderItemId) });
  const create = useAction(productionApi.createReproduction, {
    success: (r) => (r.plan ? `재생산 계획 ${r.plan.productionPlanNo}을(를) 만들었어요 (${r.planQty}${qtyUnit(r.plan.itemType)})` : `가용 재고 ${r.reservedFromStockQty}매를 예약해서 새 계획 없이 채웠어요`),
    invalidate: [...PLAN_TOPICS, 'sales-orders'],
    onSuccess: onCreated,
  });
  const p = preview.data;
  const canCreate = allowed && !!p && p.additionalQty > 0 && !create.isPending;

  return (
    <Modal
      title="재생산 계획"
      onClose={onClose}
      width={620}
      footer={(
        <>
          <SoonButton grade="P2">자동 초안</SoonButton>
          <button type="button" className="hl-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>취소</button>
          <button
            type="button"
            className="hl-btn hl-btn--primary"
            disabled={!canCreate}
            title={!allowed ? '권한이 필요해요' : p && p.additionalQty === 0 ? '추가로 생산할 매수가 없어요' : undefined}
            onClick={() => create.mutate({ salesOrderItemId, reason: reason.trim() })}
          >
            <Icon name="plus" />재생산 계획 만들기
          </button>
        </>
      )}
    >
      <QueryBoundary query={preview}>
        {(d) => {
          const unit = qtyUnit(d.productSpec.itemType);
          return (
            <div className="hl-col" style={{ gap: 14 }}>
              <div className="hl-row" style={{ flexWrap: 'wrap' }}>
                <Link className="hl-link-id" to={`/sales-orders/${d.salesOrderId}`}>{d.salesOrderNo}</Link>
                <span className="hl-muted">품목 {d.lineNo} · {d.customerName}</span>
                <Badge>{itemStatusLabel(d.salesOrderItemStatus)}</Badge>
                <span className="mono" style={{ marginLeft: 'auto', fontSize: '12px' }}>{specText(d.productSpec)}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12 }}>
                <div className="hl-figure"><span>주문</span><b>{d.orderedQty}<small>{unit}</small></b></div>
                <div className="hl-figure"><span>누적 출고</span><b>{d.shippedQty}<small>{unit}</small></b></div>
                <div className="hl-figure"><span>미확보</span><b>{d.unsecuredQty}<small>{unit}</small></b></div>
                <div className="hl-figure"><span>진행 계획 잔여</span><b>{d.openPlanRemainingQty}<small>{unit}</small></b></div>
                <div className="hl-figure"><span>추가 필요</span><b className={d.additionalQty > 0 ? 'hl-danger-text' : undefined}>{d.additionalQty}<small>{unit}</small></b></div>
              </div>
              <span className="hl-cap">추가 필요 = max(0, 미확보 − 진행 중인 계획이 아직 채워 줄 수 있는 매수). 미확보 = 주문 − 누적 출고 − 예약.</span>

              {d.openPlans.length ? (
                <div style={{ border: '1px solid var(--line)', borderRadius: 6, overflow: 'auto' }}>
                  <table className="hl-table hl-table--compact">
                    <thead><tr><th>진행 중인 계획</th><th>상태</th><th className="num">목표</th><th className="num">아직 채워 줄 수 있는 매수</th></tr></thead>
                    <tbody>
                      {d.openPlans.map((o) => (
                        <tr key={o.id}>
                          <td><Link className="hl-link-id" to={`/production/plans?plan=${o.id}`} onClick={onClose}>{o.productionPlanNo}</Link></td>
                          <td>{PRODUCTION_PLAN_STATUS_LABEL[o.productionPlanStatus] ?? o.productionPlanStatus}</td>
                          <td className="num tnum">{o.shortageQty}{unit}</td>
                          <td className="num tnum">{o.remainingTargetQty}{unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {d.additionalQty > 0 ? (
                <div className="hl-banner hl-banner--run" style={{ alignItems: 'center' }}>
                  <Icon name="info" />
                  <div>
                    같은 규격의 예약 가용 재고 <b>{d.stockAvailableQty}{unit}</b>를 먼저 예약하고, 남는 <b>{d.planQty}{unit}</b>
                    {d.planQty > 0 ? <> ({fmtTon(calcWeightTon(d.planQty, d.productSpec.theoreticalWeightTon))} · 계산값)로 재생산 계획을 만들어요.</> : <>이라 새 계획 없이 재고로 모두 채워요.</>}
                  </div>
                </div>
              ) : (
                <div className="hl-banner hl-banner--ok"><Icon name="check-circle" /><span>지금은 추가로 생산할 매수가 없어요. 검사 불합격 등으로 합격 매수가 모자라게 되면 여기서 재생산 계획을 만들 수 있어요.</span></div>
              )}
              {d.surplus ? (
                <span className="hl-cap">
                  대응 슬래브 <span className="mono">{specText(d.surplus.slabSpec)}</span> 여재 <b>{d.surplus.availableQty}매</b> — 새 계획의 히트 편성에서 "여재 사용 매수"로 쓸 수 있어요.
                </span>
              ) : null}
              <Field label="사유 (선택)" hint="작업 로그에 남아요.">
                <input className="hl-input" type="text" maxLength={500} placeholder="예: 슬래브 표면 검사 불합격 2매 대체" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <span className="hl-cap">재생산 계획은 담당자가 직접 만들어요. AI Factory Agent의 자동 초안은 준비 중이에요.</span>
            </div>
          );
        }}
      </QueryBoundary>
    </Modal>
  );
}

/** 계획 취소: 작업 시작 전(모든 실적이 대기)일 때만 */
export function CancelPlanModal({ plan, onClose }: { plan: PlanDetail; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const cancel = useAction(productionApi.cancel, { success: '생산계획을 취소했어요', invalidate: [...PLAN_TOPICS, 'sales-orders'], onSuccess: onClose });
  const confirmedAlloc = plan.rollingAllocations.filter((a) => a.status === 'CONFIRMED').length;
  return (
    <Modal
      title={<>계획 취소 · <span className="mono">{plan.productionPlanNo}</span></>}
      onClose={onClose}
      width={480}
      footer={(
        <>
          <button type="button" className="hl-btn" onClick={onClose}>닫기</button>
          <button type="button" className="hl-btn hl-btn--danger" style={{ marginLeft: 'auto' }} disabled={cancel.isPending} onClick={() => cancel.mutate({ id: plan.id, reason: reason.trim() })}>
            <Icon name="x" />계획 취소
          </button>
        </>
      )}
    >
      <div className="hl-col" style={{ gap: 12 }}>
        <span style={{ fontSize: '13px' }}>
          이 계획을 취소할까요? 작업을 시작하기 전에만 취소할 수 있어요.
          {plan.surplusUseQty > 0 ? ` 편성 때 귀속시킨 여재 ${plan.surplusUseQty}매는 재고로 돌아가요.` : ''}
          {confirmedAlloc > 0 ? ` 확정된 열연 배정 ${confirmedAlloc}건은 해제돼요.` : ''}
        </span>
        <Field label="사유 (선택)" hint="작업 로그에 남아요.">
          <input className="hl-input" type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
