import { describe, expect, it } from 'vitest';
import type { ProductionPlanStatus } from '@/codes';
import { fromDateTimeLocal, toDateTimeLocal } from '@/features/production/lib/dateTimeLocal';
import { actualLossRateText, countResultsByProcess, fmtYieldRate, planProcesses, processStepItems } from '@/features/production/lib/productionDisplay';

describe('생산 화면 표시 계산', () => {
  it('수율 문자열을 다시 계산하지 않고 백분율로 옮긴다', () => {
    expect(fmtYieldRate('0.9596')).toBe('95.96%');
    expect(fmtYieldRate('0.9800')).toBe('98%');
    expect(fmtYieldRate('1.0000')).toBe('100%');
    expect(fmtYieldRate('0.0312')).toBe('3.12%');
    expect(fmtYieldRate('0.9')).toBe('90%');
    expect(fmtYieldRate(null)).toBe('-');
    expect(fmtYieldRate('abc')).toBe('-');
  });

  it('실제 감소율 = 손실 매수 ÷ 계획 매수', () => {
    expect(actualLossRateText(10, 0)).toBe('0.00%');
    expect(actualLossRateText(40, 1)).toBe('2.50%');
    expect(actualLossRateText(0, 0)).toBe('-');
    expect(actualLossRateText(null, 1)).toBe('-');
  });

  it('라우팅: 슬래브는 열연이 없다', () => {
    expect(planProcesses('SLAB')).toEqual(['IRONMAKING', 'STEELMAKING', 'CONTINUOUS_CASTING']);
    expect(planProcesses('COIL')).toContain('HOT_ROLLING');
  });

  it('진행 표시는 편성 히트 수를 분모로 보인다', () => {
    const counts = countResultsByProcess([
      { processType: 'IRONMAKING', completedAt: '2026-09-18T01:00:00.000Z' },
      { processType: 'STEELMAKING', completedAt: '2026-09-18T02:00:00.000Z' },
      { processType: 'CONTINUOUS_CASTING', completedAt: null },
    ]);
    const steps = processStepItems({
      itemType: 'COIL',
      productionPlanStatus: 'IN_PROGRESS',
      heatCount: 2,
      heatsMadeQty: 1,
      heatsCastQty: 0,
      usableCoilQty: 0,
      shortageQty: 6,
      ...counts,
    });
    expect(steps.map((s) => s.label)).toEqual(['히트 편성 · 2히트', '제선 1건', '제강 1/2', '연주 0/2', '열연 0/6']);
    expect(steps.map((s) => s.state)).toEqual(['done', 'run', 'run', 'run', 'todo']);
  });

  it('열연 단계는 쓸 수 있는 코일(불합격 제외) 수로 완료를 정한다', () => {
    const rolling = (productionPlanStatus: ProductionPlanStatus, usableCoilQty: number) =>
      processStepItems({ itemType: 'COIL', productionPlanStatus, heatCount: 2, heatsMadeQty: 2, heatsCastQty: 2, usableCoilQty, shortageQty: 6, resultCount: {}, openCount: {} }).at(-1);
    expect(rolling('IN_PROGRESS', 5)).toMatchObject({ label: '열연 5/6', state: 'run' });
    expect(rolling('IN_PROGRESS', 6)).toMatchObject({ label: '열연 6/6', state: 'done' });
    expect(rolling('IN_PROGRESS', 0)).toMatchObject({ label: '열연 0/6', state: 'todo' });
    // 완료된 계획은 더 열연하지 않는다: 완료 뒤 코일 1개가 불합격돼 5/6이 되어도 열연 단계는 끝난 것으로 둔다
    expect(rolling('COMPLETED', 5)).toMatchObject({ label: '열연 5/6', state: 'done' });
    expect(rolling('COMPLETED', 0)).toMatchObject({ label: '열연 0/6', state: 'todo' });
  });

  it('슬래브 계획에는 열연 단계가 없다', () => {
    const steps = processStepItems({ itemType: 'SLAB', productionPlanStatus: 'IN_PROGRESS', heatCount: 1, heatsMadeQty: 1, heatsCastQty: 1, usableCoilQty: 0, shortageQty: 4, resultCount: {}, openCount: {} });
    expect(steps.map((s) => s.key)).not.toContain('HOT_ROLLING');
  });

  it('작업일시 입력칸 값은 서울 시각이다', () => {
    expect(toDateTimeLocal('2026-09-30T23:30:00.000Z')).toBe('2026-10-01T08:30');
    expect(fromDateTimeLocal('2026-10-01T08:30')).toBe('2026-09-30T23:30:00.000Z');
    expect(fromDateTimeLocal('2026-10-01 08:30')).toBe('');
    expect(toDateTimeLocal(null)).toBe('');
  });
});
