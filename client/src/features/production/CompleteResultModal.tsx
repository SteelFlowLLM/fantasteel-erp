// 작업 완료·실적 등록 (REQ-PRD-003): 공정마다 다른 입력 — 제선(고로·용선량) / 제강(전로) / 연주(슬래브 매수) / 열연(투입할 배정).
import { useState } from 'react';
import { Link } from 'react-router';
import { PROCESS_CODE_LABEL } from '@fantasteel/shared';
import { productionApi, type CompleteBody, type PlanDetail, type ResultView } from '@/api/production';
import { EmptyNote, Field, Icon, Modal } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { fmtMDHM, fmtTon } from '@/lib/format';
import { PLAN_TOPICS } from './productionHooks';
import { LotJudgeBadge, LotLink, ServerErrorBanner } from './prodUi';

const EQUIP_RE = /^[A-Za-z0-9]{1,4}$/;
const TON_RE = /^\d+(\.\d{1,3})?$/;
const COMPLETE_TOPICS = [...PLAN_TOPICS, 'quality-inspections', 'sales-orders'];

export function CompleteResultModal({ result, plan, onClose }: { result: ResultView; plan: PlanDetail; onClose: () => void }) {
  const process = result.processCode;
  const confirmedAllocs = plan.rollingAllocations.filter((a) => a.status === 'CONFIRMED');
  const [equipNo, setEquipNo] = useState('');
  const [tonText, setTonText] = useState(result.defaultHotMetalTon ?? '');
  const [qtyText, setQtyText] = useState(result.plannedQty !== null ? String(result.plannedQty) : '');
  const [picked, setPicked] = useState<number[]>(() => confirmedAllocs.map((a) => a.id));
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState<ResultView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const complete = useAction(productionApi.completeResult, {
    success: `${PROCESS_CODE_LABEL[process]} 실적을 등록했어요`,
    invalidate: COMPLETE_TOPICS,
    onSuccess: (r) => { setDone(r); setError(null); },
    onError: (e) => setError(e),
  });

  const title = (
    <>{PROCESS_CODE_LABEL[process]}{result.heatSeq !== null ? ` · 히트 ${result.heatSeq}` : ''} 작업 완료 · <span className="mono">{result.productionPlanNo}</span></>
  );

  if (done) {
    return (
      <Modal title={title} onClose={onClose} width={520} footer={<button type="button" className="hl-btn hl-btn--primary" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>}>
        <div className="hl-col" style={{ gap: 12 }}>
          <div className="hl-banner hl-banner--ok"><Icon name="check-circle" /><span><b>실적을 등록했어요.</b> {fmtMDHM(done.completedAt)} 완료{done.outputTon ? ` · 산출 ${fmtTon(done.outputTon)}` : ''}{done.outputQty !== null ? ` · ${done.outputQty}${process === 'HOT_ROLLING' ? '개' : '매'}` : ''}{done.lossQty ? ` (손실 ${done.lossQty}매)` : ''}</span></div>
          <b className="hl-label">만든 LOT {done.lots.length}개</b>
          <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
            <table className="hl-table hl-table--compact">
              <tbody>
                {done.lots.map((l) => (
                  <tr key={l.id}>
                    <td><LotLink lotNo={l.lotNo} /></td>
                    <td><LotJudgeBadge isPassed={l.isPassed} lotType={l.lotType} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!done.lots.length ? <EmptyNote>이번 실적으로 만든 LOT이 없어요</EmptyNote> : null}
          </div>
          {process !== 'IRONMAKING' ? (
            <span className="hl-cap">검사는 품질 담당이 <Link to="/quality/inspections">검사 입력</Link>에서 등록해요. 합격해야 예약·열연·출고에 쓸 수 있어요.</span>
          ) : null}
        </div>
      </Modal>
    );
  }

  // 공정별 입력 검증
  let fieldError: string | null = null;
  const body: CompleteBody = {};
  if (process === 'IRONMAKING') {
    if (!EQUIP_RE.test(equipNo.trim())) fieldError = '고로 번호는 영문·숫자 4자 이내로 입력해 주세요';
    else if (tonText.trim() !== '' && (!TON_RE.test(tonText.trim()) || Number(tonText) <= 0)) fieldError = '용선량은 0보다 큰 톤(소수 3자리까지)으로 입력해 주세요';
    body.blastFurnaceNo = equipNo.trim();
    if (tonText.trim() !== '') body.hotMetalTon = tonText.trim();
  } else if (process === 'STEELMAKING') {
    if (!EQUIP_RE.test(equipNo.trim())) fieldError = '전로 번호는 영문·숫자 4자 이내로 입력해 주세요';
    body.converterNo = equipNo.trim();
  } else if (process === 'CASTING') {
    const n = /^\d+$/.test(qtyText.trim()) ? Number(qtyText.trim()) : NaN;
    if (Number.isNaN(n)) fieldError = '슬래브 생산 매수는 0 이상의 정수로 입력해 주세요';
    else if (result.plannedQty !== null && n > result.plannedQty) fieldError = `계획 매수(${result.plannedQty}매)를 넘을 수 없어요`;
    else body.outputQty = n;
  } else {
    if (!confirmedAllocs.length) fieldError = '배정 확정된 슬래브가 없어요';
    else if (!picked.length) fieldError = '압연할 슬래브를 1매 이상 골라 주세요';
    else if (result.plannedQty !== null && picked.length > result.plannedQty) fieldError = `남은 압연 ${result.plannedQty}개보다 슬래브를 많이 골랐어요 (선택 ${picked.length}매)`;
    // 전부 고르면 비워 보낸다 (= 이 계획의 확정 배정 전부)
    else if (picked.length !== confirmedAllocs.length) body.allocationIds = picked;
  }

  const submit = () => {
    setTouched(true);
    if (fieldError) return;
    setError(null);
    complete.mutate({ id: result.id, body });
  };
  const shownError = touched ? fieldError : null;
  const toggle = (id: number) => setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={process === 'HOT_ROLLING' ? 600 : 480}
      footer={(
        <>
          <button type="button" className="hl-btn" onClick={onClose}>취소</button>
          <button type="button" className="hl-btn hl-btn--primary" style={{ marginLeft: 'auto' }} disabled={complete.isPending || (process === 'HOT_ROLLING' && !confirmedAllocs.length)} onClick={submit}>
            <Icon name="check" />{complete.isPending ? '등록 중…' : '작업 완료 · 실적 등록'}
          </button>
        </>
      )}
    >
      <div className="hl-col" style={{ gap: 14 }}>
        {error ? <ServerErrorBanner error={error} /> : null}
        <span className="hl-cap">작업 시작 {fmtMDHM(result.startedAt)} · 완료 시각은 등록하는 지금 시각으로 기록돼요.</span>

        {process === 'IRONMAKING' ? (
          <>
            <Field label="고로 번호 *" hint="영문·숫자 4자 이내 · 용선 LOT 번호(HM-고로-YYMMDD-NN)에 들어가요" error={shownError && !EQUIP_RE.test(equipNo.trim()) ? shownError : null}>
              <input className="hl-input mono" type="text" maxLength={4} placeholder="예: 1" value={equipNo} onChange={(e) => setEquipNo(e.target.value)} autoFocus />
            </Field>
            <Field
              label="용선량 (t)"
              hint={result.defaultHotMetalTon ? `이 계획에 아직 필요한 용선 ${fmtTon(result.defaultHotMetalTon)} · 비우면 이 값으로 등록하고, 적게 출선하면 남은 양의 제선 행이 이어서 생겨요` : '비우면 서버가 정한 필요량으로 등록해요'}
              error={shownError && EQUIP_RE.test(equipNo.trim()) ? shownError : null}
            >
              <span className="hl-inputwrap">
                <input className="hl-input num tnum" style={{ paddingRight: 28 }} type="text" inputMode="decimal" value={tonText} onChange={(e) => setTonText(e.target.value)} />
                <span className="hl-suffix">t</span>
              </span>
            </Field>
            <span className="hl-cap">철광석·석탄·석회석을 용선량 × 원단위만큼 원료 LOT 입고일 순(FIFO)으로 차감해요. 원료가 모자라면 등록되지 않아요.</span>
          </>
        ) : null}

        {process === 'STEELMAKING' ? (
          <>
            <Field label="전로 번호 *" hint="영문·숫자 4자 이내 · 히트 LOT 번호(HT-전로-YYMMDD-NNN)에 들어가요" error={shownError}>
              <input className="hl-input mono" type="text" maxLength={4} placeholder="예: 1" value={equipNo} onChange={(e) => setEquipNo(e.target.value)} autoFocus />
            </Field>
            <span className="hl-cap">이 계획의 용선 LOT을 FIFO로, 합금철 LOT을 히트 톤 × 원단위만큼 차감하고 히트 LOT을 만들어요 (성분 검사 대기).</span>
          </>
        ) : null}

        {process === 'CASTING' ? (
          <>
            <Field label="슬래브 생산 매수 *" hint={result.plannedQty !== null ? `계획 ${result.plannedQty}매 이하의 정수 · 적게 나오면 차이가 손실로 기록돼요` : '0 이상의 정수'} error={shownError}>
              <span className="hl-inputwrap">
                <input className={`hl-input num tnum${shownError ? ' is-error' : ''}`} style={{ paddingRight: 28 }} type="text" inputMode="numeric" value={qtyText} onChange={(e) => setQtyText(e.target.value)} autoFocus />
                <span className="hl-suffix">매</span>
              </span>
            </Field>
            <span className="hl-cap">슬래브 LOT(히트번호-SS)을 매별로 만들어요 (검사 대기). 히트 성분 검사 전에도 연주는 진행할 수 있지만, 미합격 LOT은 예약·열연·출고에 쓸 수 없어요.</span>
          </>
        ) : null}

        {process === 'HOT_ROLLING' ? (
          <>
            <div className="hl-row">
              <b className="hl-label">압연할 슬래브 (배정 확정분)</b>
              <span className="hl-cap">선택 {picked.length} / 확정 {confirmedAllocs.length}매{result.plannedQty !== null ? ` · 남은 압연 ${result.plannedQty}개` : ''}</span>
              <button type="button" className="hl-btn hl-btn--sm hl-btn--ghost" style={{ marginLeft: 'auto' }} disabled={!confirmedAllocs.length} onClick={() => setPicked(picked.length === confirmedAllocs.length ? [] : confirmedAllocs.map((a) => a.id))}>
                {picked.length === confirmedAllocs.length ? '전체 해제' : '전체 선택'}
              </button>
            </div>
            {confirmedAllocs.length ? (
              <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
                <table className="hl-table hl-table--compact">
                  <thead><tr><th className="ctr" style={{ width: 44 }}>선택</th><th>슬래브 LOT</th><th>히트</th><th>배정 확정</th></tr></thead>
                  <tbody>
                    {confirmedAllocs.map((a) => (
                      <tr key={a.id} className={picked.includes(a.id) ? 'is-selected' : undefined}>
                        <td className="ctr"><input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggle(a.id)} aria-label={`${a.lotNo} 선택`} /></td>
                        <td><LotLink lotNo={a.lotNo} /></td>
                        <td className="mono">{a.heatLotNo ?? '-'}</td>
                        <td className="tnum">{fmtMDHM(a.confirmedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="hl-banner hl-banner--wait">
                <Icon name="alert" />
                <span>배정 확정된 슬래브가 없어요. <Link to={`/production/rolling?plan=${plan.id}`}>열연 투입 배정</Link>에서 슬래브를 먼저 확정해 주세요.</span>
              </div>
            )}
            {shownError && confirmedAllocs.length ? <span className="hl-field__hint hl-danger-text">{shownError}</span> : null}
            <span className="hl-cap">슬래브 1매당 코일 LOT 1개(C + 슬래브번호)를 만들어요 (검사 대기). 목표에 못 미치면 남은 압연분의 열연 행이 이어서 생겨요.</span>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
