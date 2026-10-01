'use client';

// 실적 시뮬레이션 (REQ-PRD-007, 업무 프로세스 8장 BP-SEED-01): 고정 계획 수율, 연주에서만 0~5% 샘플 손실 → 손실 매수 = floor(계획 매수 × 손실률).
// 같은 난수 시드 → 같은 결과. 검사값은 넣지 않는다.
import { useState } from 'react';
import { PROCESS_TYPE_LABEL } from '@/codes';
import { MAX_RANDOM_SEED, productionResultApi, SIMULATION_DEFAULT_CODES, type SimulationResult } from '@/api/productionResults';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Kpi, StatBar } from '@/components/Kpi';
import { Modal } from '@/components/Modal';
import { Table, Td, Th } from '@/components/Table';
import { LotLinks } from '@/features/production/components/ResultsTable';
import { fieldErrorsOf } from '@/features/production/lib/formErrors';
import { actualLossRateText, fmtLossRate } from '@/features/production/lib/productionDisplay';
import { useAction } from '@/hooks/useAction';

export function SimulationModal({ planId, planNo, onClose }: { planId: number; planNo: string; onClose: () => void }) {
  const [seedText, setSeedText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const simulate = useAction(productionResultApi.simulate, {
    success: '실적 시뮬레이션을 실행했어요',
    onSuccess: (data) => setResult(data),
    onError: (e) => setError(fieldErrorsOf(e).randomSeed ?? null),
  });

  const run = () => {
    setError(null);
    const text = seedText.trim();
    if (text && (!/^\d+$/.test(text) || Number(text) > MAX_RANDOM_SEED)) {
      setError(`0 ~ ${MAX_RANDOM_SEED.toLocaleString('en-US')} 사이의 정수로 입력해 주세요`);
      return;
    }
    simulate.mutate({ productionPlanId: planId, randomSeed: text ? Number(text) : null });
  };

  if (result) {
    const casting = result.steps.filter((s) => s.processType === 'CONTINUOUS_CASTING');
    const lossQty = casting.reduce((sum, s) => sum + (s.lossQty ?? 0), 0);
    return (
      <Modal title={`실적 시뮬레이션 결과 · ${planNo}`} onClose={onClose} width={780} footer={<Button onClick={onClose}>닫기</Button>}>
        <StatBar>
          <Kpi flat label="난수 시드" value={<span className="font-mono text-2xl">{result.randomSeed}</span>} sub="같은 시드 · 같은 상태면 같은 결과" />
          <Kpi flat label="만든 작업 실적" value={result.steps.length} unit="건" />
          <Kpi flat label="연주 손실 매수" value={lossQty} unit="매" sub="floor(계획 매수 × 샘플 손실률)" />
          <Kpi flat label="만든 LOT" value={result.steps.reduce((sum, s) => sum + s.outputLotNos.length, 0)} unit="개" />
        </StatBar>
        {result.skippedRolling ? <Banner tone="wait">{result.skippedRolling}</Banner> : null}
        <Table compact>
          <thead>
            <tr>
              <Th>순서</Th>
              <Th>공정</Th>
              <Th align="right">계획 슬래브</Th>
              <Th align="right">샘플 손실률</Th>
              <Th align="right">손실 매수</Th>
              <Th align="right">실제 감소율</Th>
              <Th align="right">실적 매수</Th>
              <Th>만든 LOT</Th>
            </tr>
          </thead>
          <tbody>
            {result.steps.map((s, index) => (
              <tr key={s.productionResultId}>
                <Td>{index + 1}</Td>
                <Td className="font-medium">{PROCESS_TYPE_LABEL[s.processType]}</Td>
                <Td align="right">{s.plannedQty ?? '-'}</Td>
                <Td align="right">{s.sampleLossRate ? fmtLossRate(s.sampleLossRate) : '-'}</Td>
                <Td align="right">{s.lossQty ?? '-'}</Td>
                <Td align="right">{s.plannedQty !== undefined ? actualLossRateText(s.plannedQty, s.lossQty) : '-'}</Td>
                <Td align="right">{s.outputQty ?? (s.processType === 'HOT_ROLLING' ? s.outputLotNos.length : '-')}</Td>
                <Td className="whitespace-normal">
                  <LotLinks lotNos={s.outputLotNos} max={4} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {result.steps.length === 0 ? <Banner>남은 공정이 없어 새 실적을 만들지 않았어요.</Banner> : null}
        <span className="text-cap text-ink-3">검사값은 넣지 않았어요. 히트·슬래브·코일은 검사 입력에서 판정해요. 열연은 슬래브가 합격한 뒤 다시 실행하면 이어서 해요.</span>
      </Modal>
    );
  }

  return (
    <Modal
      title={`실적 시뮬레이션 · ${planNo}`}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button onClick={onClose} disabled={simulate.isPending}>
            닫기
          </Button>
          <Button variant="primary" icon="flow" onClick={run} disabled={simulate.isPending}>
            {simulate.isPending ? '실행하는 중…' : '실행'}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-5 text-ink-2">
        이 계획의 남은 공정(제선 → 제강 → 연주 → 코일이면 열연)의 작업 실적을 시연용으로 만들어요. 계획 수율은 고정이고, 연주에서만 0~5% 샘플 손실률로 슬래브 매수가 줄어요. 열연은 슬래브 1매 = 코일 1개예요.
      </p>
      <Field label="난수 시드 (선택)" hint="비우면 실행 시각으로 정하고 결과에 보여 줘요. 같은 시드면 같은 결과가 나와요." error={error}>
        <Input value={seedText} onChange={(e) => setSeedText(e.target.value)} placeholder="예: 20261001" inputMode="numeric" invalid={!!error} />
      </Field>
      <span className="text-cap text-ink-3">
        고로 {SIMULATION_DEFAULT_CODES.blastFurnaceCode} · 전로 {SIMULATION_DEFAULT_CODES.converterCode} · 작업 시각은 지금 끝나도록 거꾸로 배치해요 (제선 4시간 · 제강 1시간 · 연주 2시간 · 열연 2시간). 원료가
        모자라면 실행되지 않아요.
      </span>
    </Modal>
  );
}
