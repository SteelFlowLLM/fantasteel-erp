'use client';

// 작업 실적 입력 창 (BP-PRD-02 표 그대로):
// 제선 = 고로 코드·작업일시·원료 투입 기간(= 작업 시작~완료)·용선량 / 제강 = 전로 코드·히트 순번·투입 용선량 / 연주 = 히트·규격·슬래브 생산 매수·작업일시.
// 'start'는 작업 시작만 기록하고(완료 일시 없음), 'complete'는 시작한 실적을 같은 행으로 완료한다.
import { useState } from 'react';
import { INSPECTION_RESULT_LABEL, PROCESS_TYPE_LABEL } from '@/codes';
import { productionResultApi, type WorkContext } from '@/api/productionResults';
import type { ProductionResultView } from '@/api/production';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { Table, Td, Th } from '@/components/Table';
import { dateTimeLocalHoursAgo, fromDateTimeLocal, toDateTimeLocal } from '@/features/production/lib/dateTimeLocal';
import { fieldErrorsOf } from '@/features/production/lib/formErrors';
import { useAction } from '@/hooks/useAction';
import { decCmp, decMul, isDecimalText, TON_DIGITS } from '@/lib/decimal';
import { fmtDateTime, fmtTon } from '@/lib/format';
import { ferroalloyTonFor, rawMaterialTonFor } from '@/lib/mrp';
import { specificConsumptionUnitOf } from '@/lib/units';

export type WorkProcess = 'IRONMAKING' | 'STEELMAKING' | 'CONTINUOUS_CASTING';
export type ResultFormMode = 'register' | 'start' | 'complete';

/** 작업일시 기본값: 지금 끝난 작업으로 (제선 4시간 · 제강 1시간 · 연주 2시간, 시뮬레이션과 같은 가정값) */
const DEFAULT_HOURS: Record<WorkProcess, number> = { IRONMAKING: 4, STEELMAKING: 1, CONTINUOUS_CASTING: 2 };

const LOT_FORMAT: Record<WorkProcess, string> = {
  IRONMAKING: '용선 LOT HM-고로-YYMMDD-NN',
  STEELMAKING: '히트 HT-전로-YYMMDD-NNN · 성분 검사 대상',
  CONTINUOUS_CASTING: '슬래브 히트번호-SS (1매씩) · 표면·치수 검사 대상',
};

export interface ResultFormModalProps {
  ctx: WorkContext;
  process: WorkProcess;
  mode: ResultFormMode;
  /** complete일 때 완료할 실적 */
  openResult?: ProductionResultView | null;
  onClose: () => void;
}

export function ResultFormModal({ ctx, process, mode, openResult, onClose }: ResultFormModalProps) {
  const plan = ctx.plan;
  const [startedText, setStartedText] = useState(() => (openResult ? toDateTimeLocal(openResult.startedAt) : dateTimeLocalHoursAgo(DEFAULT_HOURS[process])));
  const [completedText, setCompletedText] = useState(() => dateTimeLocalHoursAgo(0));
  const [blastFurnaceCode, setBlastFurnaceCode] = useState(openResult?.blastFurnaceCode ?? ctx.lastBlastFurnaceCode ?? '');
  const [converterCode, setConverterCode] = useState(openResult?.converterCode ?? ctx.lastConverterCode ?? '');
  const [tonText, setTonText] = useState(ctx.hotMetalTonPerHeat);
  // 작업 완료: 작업 시작 때 기록한 히트로 고정한다 (작업 로그 PRODUCTION_STARTED와 실적·슬래브의 히트가 같아야 한다)
  const startedHeatLotId = mode === 'complete' && openResult ? (ctx.openWork.find((w) => w.productionResultId === openResult.id)?.heatLotId ?? null) : null;
  const firstHeat = ctx.uncastHeats.find((h) => h.heatLotId === startedHeatLotId) ?? ctx.uncastHeats[0];
  const [heatLotId, setHeatLotId] = useState<number | null>(startedHeatLotId ?? firstHeat?.heatLotId ?? null);
  const heat = ctx.uncastHeats.find((h) => h.heatLotId === heatLotId) ?? null;
  const [qtyText, setQtyText] = useState(String(firstHeat?.maxSlabQty ?? ''));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const label = PROCESS_TYPE_LABEL[process];
  const heatSeq = plan.progress.heatsMadeQty + 1;
  const onError = (error: unknown) => setErrors(fieldErrorsOf(error));
  const common = { onSuccess: onClose, onError };
  const start = useAction(productionResultApi.startWork, { ...common, success: `${label} 작업을 시작했어요` });
  const ironmaking = useAction(productionResultApi.registerIronmaking, { ...common, success: (r) => `제선 실적을 등록했어요 · ${r.outputLotNos.join(', ')}` });
  const steelmaking = useAction(productionResultApi.registerSteelmaking, { ...common, success: (r) => `제강 실적을 등록했어요 · ${r.outputLotNos.join(', ')}` });
  const casting = useAction(productionResultApi.registerCasting, { ...common, success: (r) => `연주 실적을 등록했어요 · 슬래브 ${r.outputLotNos.length}매` });
  const pending = start.isPending || ironmaking.isPending || steelmaking.isPending || casting.isPending;

  const tonValid = isDecimalText(tonText) && decCmp(tonText, 0) > 0;
  const startedAt = fromDateTimeLocal(startedText);
  const completedAt = fromDateTimeLocal(completedText);
  const productionResultId = mode === 'complete' ? (openResult?.id ?? null) : null;

  const submit = () => {
    setErrors({});
    if (mode === 'start') {
      start.mutate({ productionPlanId: plan.id, processType: process, startedAt, blastFurnaceCode, converterCode, heatLotId });
      return;
    }
    if (process === 'IRONMAKING') ironmaking.mutate({ productionPlanId: plan.id, blastFurnaceCode, startedAt, completedAt, outputTon: tonText.trim(), productionResultId });
    else if (process === 'STEELMAKING') steelmaking.mutate({ productionPlanId: plan.id, converterCode, startedAt, completedAt, inputHotMetalTon: tonText.trim(), productionResultId });
    else {
      if (!/^\d+$/.test(qtyText.trim()) || Number(qtyText) < 1) {
        setErrors({ outputQty: '슬래브 생산 매수는 1 이상의 정수로 입력해 주세요' });
        return;
      }
      if (heatLotId === null) {
        setErrors({ heatLotId: '연주할 히트를 골라 주세요' });
        return;
      }
      casting.mutate({ productionPlanId: plan.id, heatLotId, outputQty: Number(qtyText.trim()), startedAt, completedAt, productionResultId });
    }
  };

  const title = mode === 'start' ? `${label} 작업 시작` : mode === 'complete' ? `${label} 작업 완료` : `${label} 실적 등록`;
  const heatTon = process === 'STEELMAKING' && tonValid ? decMul(tonText, ctx.steelmakingYieldRate, TON_DIGITS) : null;

  return (
    <Modal
      title={`${title} · ${plan.productionPlanNo}`}
      onClose={onClose}
      width={process === 'IRONMAKING' ? 600 : 520}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            닫기
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending}>
            {pending ? '등록하는 중…' : mode === 'start' ? '작업 시작' : mode === 'complete' ? '작업 완료 · 실적 등록' : '실적 등록'}
          </Button>
        </>
      }
    >
      <span className="text-cap text-ink-3">
        {LOT_FORMAT[process]} · 작업일시는 서울 시각이에요{mode === 'start' ? ' · 완료할 때 산출을 입력해요' : ''}
      </span>
      {errors.productionPlanId ? <Banner tone="danger">{errors.productionPlanId}</Banner> : null}
      {errors.productionResultId ? <Banner tone="danger">{errors.productionResultId}</Banner> : null}

      {process === 'IRONMAKING' ? (
        <Field label="고로 코드" required hint="대문자·숫자 2~10자 (예: BF2)" error={errors.blastFurnaceCode}>
          <Input value={blastFurnaceCode} onChange={(e) => setBlastFurnaceCode(e.target.value)} placeholder="예: BF2" maxLength={10} invalid={!!errors.blastFurnaceCode} disabled={mode === 'complete'} />
        </Field>
      ) : null}
      {process === 'STEELMAKING' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="전로 코드" required hint="대문자·숫자 2~10자 (예: BOF1)" error={errors.converterCode}>
            <Input value={converterCode} onChange={(e) => setConverterCode(e.target.value)} placeholder="예: BOF1" maxLength={10} invalid={!!errors.converterCode} disabled={mode === 'complete'} />
          </Field>
          <Field label="히트 편성">
            <Input value={`${heatSeq}번째 히트 / 편성 ${plan.progress.heatCount}개`} readOnly />
          </Field>
        </div>
      ) : null}
      {process === 'CONTINUOUS_CASTING' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="히트" required error={errors.heatLotId} hint={startedHeatLotId !== null ? '작업 시작 때 기록한 히트예요' : undefined}>
            <Select
              value={heatLotId ?? ''}
              disabled={startedHeatLotId !== null}
              onChange={(e) => {
                const id = Number(e.target.value);
                setHeatLotId(id);
                setQtyText(String(ctx.uncastHeats.find((h) => h.heatLotId === id)?.maxSlabQty ?? ''));
              }}
              invalid={!!errors.heatLotId}
            >
              {ctx.uncastHeats.length === 0 ? <option value="">연주할 히트가 없어요</option> : null}
              {ctx.uncastHeats.map((h) => (
                <option key={h.heatLotId} value={h.heatLotId}>
                  {h.heatLotNo} · {fmtTon(h.heatTon)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="규격">
            <Input value={plan.slabSpec?.itemCode ?? '-'} readOnly className="font-mono" />
          </Field>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="작업 시작 일시" required error={errors.startedAt}>
          <Input type="datetime-local" value={startedText} onChange={(e) => setStartedText(e.target.value)} invalid={!!errors.startedAt} readOnly={mode === 'complete'} />
        </Field>
        {mode === 'start' ? (
          <Field label="작업 완료 일시">
            <Input value="완료할 때 입력해요" readOnly />
          </Field>
        ) : (
          <Field label="작업 완료 일시" required error={errors.completedAt}>
            <Input type="datetime-local" value={completedText} onChange={(e) => setCompletedText(e.target.value)} invalid={!!errors.completedAt} />
          </Field>
        )}
      </div>

      {mode !== 'start' && process === 'IRONMAKING' ? (
        <>
          <Field label="원료 투입 기간" hint="제선 작업 시작~완료. 이 기간에 FIFO로 차감한 원료 LOT만 기간 기반으로 이어요">
            <Input value={startedAt && completedAt ? `${fmtDateTime(startedAt)} ~ ${fmtDateTime(completedAt)}` : '-'} readOnly />
          </Field>
          <Field label="용선량" required hint={`히트 1개 몫 ${fmtTon(ctx.hotMetalTonPerHeat)} = 히트 용량 ${fmtTon(ctx.heatCapacityTon)} ÷ 제강 수율`} error={errors.outputTon}>
            <Input value={tonText} onChange={(e) => setTonText(e.target.value)} numeric suffix="t" invalid={!!errors.outputTon} inputMode="decimal" />
          </Field>
          <Table compact>
            <thead>
              <tr>
                <Th>원료</Th>
                <Th align="right">원단위</Th>
                <Th align="right">투입 예정 (용선량 × 원단위)</Th>
                <Th align="right">원료 LOT 잔량</Th>
              </tr>
            </thead>
            <tbody>
              {ctx.ironmakingMaterials.map((m) => {
                const need = tonValid ? rawMaterialTonFor(tonText, m.consumptionRate) : null;
                const short = need !== null && decCmp(need, m.remainingTon) > 0;
                return (
                  <tr key={m.itemId} data-risk={short ? true : undefined}>
                    <Td>{m.itemName}</Td>
                    <Td align="right">
                      {m.consumptionRate} {specificConsumptionUnitOf(m.rawMaterialType)}
                    </Td>
                    <Td align="right" className={short ? 'font-semibold text-danger' : undefined}>
                      {need ? fmtTon(need) : '-'}
                    </Td>
                    <Td align="right">{fmtTon(m.remainingTon)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <span className="text-cap text-ink-3">원료 LOT은 입고일 순(FIFO)으로 차감해요. 완료일보다 늦게 들어온 LOT은 쓰지 않고, 모자라면 등록되지 않아요(구매·입고 먼저).</span>
        </>
      ) : null}

      {mode !== 'start' && process === 'STEELMAKING' ? (
        <>
          <Field
            label="투입 용선량"
            required
            hint={`쓸 수 있는 용선 ${fmtTon(ctx.hotMetalAvailableTon)} · 용선 LOT은 생산 순(FIFO)으로 자동 선택해요`}
            error={errors.inputHotMetalTon}
          >
            <Input value={tonText} onChange={(e) => setTonText(e.target.value)} numeric suffix="t" invalid={!!errors.inputHotMetalTon} inputMode="decimal" />
          </Field>
          <Table compact>
            <thead>
              <tr>
                <Th>계산</Th>
                <Th align="right">값</Th>
                <Th align="right">잔량</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>히트 톤 = 투입 용선 × 제강 수율 {ctx.steelmakingYieldRate}</Td>
                <Td align="right" className="font-semibold">
                  {heatTon ? fmtTon(heatTon) : '-'}
                </Td>
                <Td align="right">-</Td>
              </tr>
              {ctx.ferroalloys.map((m) => {
                const need = heatTon ? ferroalloyTonFor(heatTon, m.consumptionRate) : null;
                const short = need !== null && decCmp(need, m.remainingTon) > 0;
                return (
                  <tr key={m.itemId} data-risk={short ? true : undefined}>
                    <Td>
                      {m.itemName} = 히트 톤 × {m.consumptionRate} kg/t ÷ 1,000
                    </Td>
                    <Td align="right" className={short ? 'font-semibold text-danger' : undefined}>
                      {need ? fmtTon(need) : '-'}
                    </Td>
                    <Td align="right">{fmtTon(m.remainingTon)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <span className="text-cap text-ink-3">합금철은 입고일 순(FIFO)으로 원료 LOT에서 자동 차감해요. 용선→히트, 합금철→히트는 실제 투입으로 이어요.</span>
        </>
      ) : null}

      {mode !== 'start' && process === 'CONTINUOUS_CASTING' ? (
        <Field
          label="슬래브 생산 매수"
          required
          hint={heat ? `이 히트에서 나올 수 있는 슬래브는 최대 ${heat.maxSlabQty}매 (히트 톤 × 연주 수율 ÷ 슬래브 1매 이론중량, 내림)` : undefined}
          error={errors.outputQty}
        >
          <Input value={qtyText} onChange={(e) => setQtyText(e.target.value)} numeric suffix="매" invalid={!!errors.outputQty} inputMode="numeric" />
        </Field>
      ) : null}
      {heat && heat.inspectionResult !== 'PASS' && process === 'CONTINUOUS_CASTING' ? (
        <Banner tone="wait">
          이 히트의 성분 판정이 {heat.inspectionResult === 'FAIL' ? INSPECTION_RESULT_LABEL.FAIL : '아직'}이에요. 연주는 할 수 있지만, 히트가 합격하기 전에는 슬래브를 예약·열연·출고할 수 없어요.
        </Banner>
      ) : null}
    </Modal>
  );
}
