// 히트 편성표 (REQ-PRD-002, 업무 프로세스 4.4, 14.1-2: 히트 전체 톤과 수주 목표를 나눠 보인다)
import { PRODUCT_QTY_UNIT } from '@/codes';
import type { ProductionPlanDetail } from '@/api/production';
import { Banner } from '@/components/Banner';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Steps, type StepItem } from '@/components/Steps';
import { Table, Td, Th } from '@/components/Table';
import { fmtYieldRate } from '@/features/production/lib/productionDisplay';
import { fmtTon } from '@/lib/format';

function Figure({ label, value, unit, strong }: { label: string; value: string | number; unit?: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-cap text-ink-3">{label}</span>
      <b className={strong ? 'text-2xl font-semibold tabular-nums' : 'text-lg font-semibold tabular-nums'}>
        {value}
        {unit ? <small className="ml-0.5 text-xs font-medium text-ink-3">{unit}</small> : null}
      </b>
    </div>
  );
}

export function FormationCard({ plan, steps }: { plan: ProductionPlanDetail; steps: StepItem[] }) {
  const f = plan.formation;
  const unit = PRODUCT_QTY_UNIT[plan.item.itemType];
  if (!f) {
    return (
      <Card>
        <CardHead title="히트 편성" />
        <CardBody>
          <Banner tone="danger">기준정보(라우팅 수율·규격 매핑·배합 원단위·히트 용량)가 모자라 편성표를 계산하지 못했어요. 기준정보 준비 상태를 확인해 주세요.</Banner>
        </CardBody>
      </Card>
    );
  }
  const yieldRule = plan.item.itemType === 'COIL' ? '연주 수율 × 열연 수율(규격 매핑 계산값)' : '연주 수율 (슬래브 수주는 연주만)';
  const rows: { label: string; value: string; rule: string }[] = [
    { label: '부족 매수', value: `${f.shortageQty}${unit}`, rule: '수주 등록 때 재고로 예약하지 못한 매수' },
    { label: '수주 목표 (목표중량)', value: fmtTon(f.targetWeightTon), rule: `부족 매수 × 1매 이론중량 ${fmtTon(plan.item.unitWeightTon)}` },
    { label: '누적 계획수율', value: fmtYieldRate(f.cumulativeYieldRate), rule: yieldRule },
    { label: '필요 용강량', value: fmtTon(f.requiredSteelTon), rule: '목표중량 ÷ 누적 계획수율' },
    { label: '히트 수', value: `${f.heatCount}개`, rule: `ceil(필요 용강량 ÷ 히트 용량 ${fmtTon(f.heatCapacityTon)})` },
    { label: '히트 톤 (히트 전체)', value: fmtTon(f.heatTon), rule: '히트 수 × 히트 용량 (용강 기준)' },
    {
      label: '히트당 슬래브',
      value: `${f.slabQtyPerHeat}매`,
      rule: `floor(히트 용량 × 연주 수율 ÷ 슬래브 1매 이론중량 ${plan.slabSpec ? fmtTon(plan.slabSpec.unitWeightTon) : '-'})`,
    },
    { label: '계획 슬래브', value: `${f.plannedSlabQty}매`, rule: '히트 수 × 히트당 슬래브' },
    { label: '예상 슬래브 여재', value: `${f.expectedSurplusSlabQty}매`, rule: 'max(0, 계획 슬래브 − 부족 매수) · 여재는 가용재고에 들어가요' },
  ];
  return (
    <Card>
      <CardHead title="히트 편성" meta={`수주 등록 때 계산 · ${plan.item.steelGradeCode ?? ''} 강종 기준`} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3 border-b border-line px-4 py-3">
        <Figure label="부족 매수" value={f.shortageQty} unit={unit} strong />
        <Figure label="수주 목표" value={fmtTon(f.targetWeightTon)} />
        <Figure label="누적 계획수율" value={fmtYieldRate(f.cumulativeYieldRate)} />
        <Figure label="필요 용강량" value={fmtTon(f.requiredSteelTon)} />
        <Figure label="히트 수" value={f.heatCount} unit="개" strong />
        <Figure label="히트 톤 (히트 전체)" value={fmtTon(f.heatTon)} />
        <Figure label="계획 슬래브" value={f.plannedSlabQty} unit="매" />
        <Figure label="예상 슬래브 여재" value={f.expectedSurplusSlabQty} unit="매" />
      </div>
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <Steps items={steps} className="overflow-x-auto" />
        <span className="text-cap text-ink-3">
          히트 전체 {fmtTon(f.heatTon)} 가운데 수주 목표는 {fmtTon(f.targetWeightTon)}이에요. 남는 쇳물은 슬래브로 만들어 예상 여재 {f.expectedSurplusSlabQty}매로 남아요.
        </span>
      </div>
      <CardBody flush>
        <Table compact>
          <thead>
            <tr>
              <Th>항목</Th>
              <Th align="right">값</Th>
              <Th>계산</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <Td className="font-medium">{row.label}</Td>
                <Td align="right" className="font-semibold">
                  {row.value}
                </Td>
                <Td className="whitespace-normal text-xs text-ink-3">{row.rule}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </CardBody>
    </Card>
  );
}
