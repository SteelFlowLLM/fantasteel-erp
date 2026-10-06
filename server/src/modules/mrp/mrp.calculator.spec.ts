import { Prisma } from '../../generated/prisma/client';
import { materialTotals, netRequirements, planRequirements, tonText, type MrpDemand, type MrpSupply } from './mrp.calculator';

const T = (v: string) => new Prisma.Decimal(v);
const ORE = 1;
const SMN = 4;

const demand = (productionPlanId: number, requiredDate: string, requiredTon: string, itemId = ORE): MrpDemand => ({ productionPlanId, itemId, requiredDate, requiredTon: T(requiredTon) });
const remaining = (ton: string, sourceId = 1, itemId = ORE): MrpSupply => ({ kind: 'REMAINING', itemId, ton: T(ton), availableDate: null, reservedForPlanId: null, sourceId });
const scheduled = (ton: string, availableDate: string | null, reservedForPlanId: number | null = null, sourceId = 1): MrpSupply => ({ kind: 'SCHEDULED', itemId: ORE, ton: T(ton), availableDate, reservedForPlanId, sourceId });
const texts = (lines: ReturnType<typeof netRequirements>) =>
  lines.map((l) => [l.productionPlanId, tonText(l.usedRemainingTon), tonText(l.usedScheduledReceiptTon), tonText(l.netRequirementTon)]);

describe('MRP 소요량 (업무 프로세스 4.4, mrp.md 4장)', () => {
  it('시드 예: 히트 250t, 제강 수율 0.90 → 용선 277.778t, 철광석 444.444·석탄 166.667·석회석 41.667t, 합금철 20kg/t → 5.000t', () => {
    const result = planRequirements('250', '0.90', [
      { itemId: 1, isFerroalloy: false, consumptionRate: '1.6' },
      { itemId: 2, isFerroalloy: false, consumptionRate: '0.6' },
      { itemId: 3, isFerroalloy: false, consumptionRate: '0.15' },
      { itemId: SMN, isFerroalloy: true, consumptionRate: '20' },
    ]);

    expect(tonText(result.requiredHotMetalTon)).toBe('277.778');
    // 용선을 277.778로 먼저 반올림하면 철광석이 444.445가 된다: 중간값은 반올림하지 않는다
    expect(result.materials.map((m) => [m.itemId, tonText(m.requiredTon)])).toEqual([
      [1, '444.444'],
      [2, '166.667'],
      [3, '41.667'],
      [SMN, '5.000'],
    ]);
  });
});

describe('MRP 순소요 차감', () => {
  it('잔량·입고예정이 소요보다 크면 순소요 0, 모자라면 남은 만큼', () => {
    expect(texts(netRequirements([demand(1, '2026-10-10', '100')], [remaining('60'), scheduled('70', '2026-10-05')]))).toEqual([[1, '60.000', '40.000', '0.000']]);
    expect(texts(netRequirements([demand(1, '2026-10-10', '100')], [remaining('30')]))).toEqual([[1, '30.000', '0.000', '70.000']]);
  });

  it('필요일 뒤에 도착하거나 입고예정일이 없는 발주는 빼고, 필요일 당일 도착은 쓴다', () => {
    const supplies = [scheduled('10', '2026-10-11', null, 1), scheduled('10', null, null, 2), scheduled('5', '2026-10-10', null, 3)];
    expect(texts(netRequirements([demand(1, '2026-10-10', '30')], supplies))).toEqual([[1, '0.000', '5.000', '25.000']]);
  });

  it('같은 공급을 두 계획에서 중복 차감하지 않고, 필요일이 이른 계획이 먼저 쓴다', () => {
    const lines = netRequirements([demand(2, '2026-10-20', '50'), demand(1, '2026-10-10', '50')], [remaining('70')]);
    expect(texts(lines)).toEqual([
      [1, '50.000', '0.000', '0.000'],
      [2, '20.000', '0.000', '30.000'],
    ]);
  });

  it('계획 몫 입고예정은 그 계획이 먼저 쓰고, 소요가 남은 다른 계획은 쓰지 않는다', () => {
    const lines = netRequirements([demand(1, '2026-10-10', '40'), demand(2, '2026-10-20', '40')], [scheduled('40', '2026-10-05', 2)]);
    expect(texts(lines)).toEqual([
      [1, '0.000', '0.000', '40.000'],
      [2, '0.000', '40.000', '0.000'],
    ]);
  });

  it('소요가 없는(끝난) 계획 몫 입고예정은 누구나 쓴다', () => {
    expect(texts(netRequirements([demand(1, '2026-10-10', '40')], [scheduled('40', '2026-10-05', 9)]))).toEqual([[1, '0.000', '40.000', '0.000']]);
  });
});

describe('MRP 원료별 합계', () => {
  it('소요·쓴 공급·순소요는 보이는 줄만, 잔량·입고예정은 원료 전체, 첫 부족 필요일', () => {
    const supplies = [remaining('30'), scheduled('20', '2026-10-30', null, 5)];
    const lines = netRequirements([demand(1, '2026-10-10', '20'), demand(2, '2026-10-15', '40')], supplies);
    const [ore, smn] = materialTotals([ORE, SMN], lines.filter((l) => l.productionPlanId === 2), supplies);

    expect([ore.requiredTon, ore.remainingTon, ore.scheduledReceiptTon, ore.usedRemainingTon, ore.usedScheduledReceiptTon, ore.netRequirementTon].map(tonText)).toEqual([
      '40.000',
      '30.000',
      '20.000',
      '10.000',
      '0.000',
      '30.000',
    ]);
    expect(ore.firstShortageDate).toBe('2026-10-15');
    expect([tonText(smn.requiredTon), smn.firstShortageDate]).toEqual(['0.000', null]);
  });
});
