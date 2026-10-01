import { describe, expect, it } from 'vitest';
import { computeMasterReadiness } from '@/features/masterData/lib/readiness';
import { createSeedTables } from '@/mock/seed';
import type { MockTables } from '@/mock/schema';
import { insertRow, type MockTx } from '@/mock/store';

/** 시드 기준정보에서 검사 기준만 비운 표 (병합 뒤 시드 검사 기준이 생겨도 같은 결과가 나오게) */
function seedWithoutStandards(): MockTables {
  const tables = createSeedTables();
  tables.inspectionStandard = [];
  tables.inspectionStandardItem = [];
  return tables;
}

const txOf = (tables: MockTables): MockTx => ({ tables, now: new Date('2026-10-01T00:00:00Z'), nowIso: '2026-10-01T00:00:00.000Z' });
const gradeId = (tables: MockTables, code: string) => tables.steelGrade.find((g) => g.steelGradeCode === code)?.id ?? 0;

/** 규격이 있는 시드 강종 4종 × 검사 공정 3개의 지금 버전 기준 (항목 1개씩) */
function addAllStandards(tables: MockTables): void {
  const tx = txOf(tables);
  for (const code of ['SS275', 'SM355A', 'SM355B', 'SPHC']) {
    for (const [processType, suffix] of [['STEELMAKING', 'SM'], ['CONTINUOUS_CASTING', 'CC'], ['HOT_ROLLING', 'HR']] as const) {
      const standard = insertRow(tx, 'inspectionStandard', { inspectionStandardCode: `QS-${code}-${suffix}`, version: 1, processType, steelGradeId: gradeId(tables, code), isCurrent: true });
      insertRow(tx, 'inspectionStandardItem', {
        inspectionStandardId: standard.id,
        inspectionItemCode: 'X',
        inspectionItemName: '항목',
        unit: null,
        minValue: '0',
        maxValue: null,
        minThicknessMm: null,
        maxThicknessMm: null,
        isRequired: true,
        sortOrder: 1,
      });
    }
  }
}

describe('기준정보 준비 상태 (BP-MST-01, MST-001)', () => {
  it('검사 기준이 없으면 규격이 있는 강종 4종 × 제강·연주·열연 = 12건이 누락이다 (SM355C·D와 제선은 보지 않는다)', () => {
    const result = computeMasterReadiness(seedWithoutStandards());
    expect(result.ready).toBe(false);
    expect(result.problems.every((p) => p.area === 'INSPECTION_STANDARD')).toBe(true);
    expect(result.problems).toHaveLength(12);
    expect(result.problems.map((p) => p.message)).toContain('SM355A 열연 검사 기준이 없어요');
  });

  it('검사 기준이 모두 있으면 준비 완료. 공통 기준(강종 없음)도 인정한다', () => {
    const tables = seedWithoutStandards();
    addAllStandards(tables);
    expect(computeMasterReadiness(tables)).toEqual({ ready: true, problems: [] });

    const shared = seedWithoutStandards();
    addAllStandards(shared);
    const sphcHr = shared.inspectionStandard.find((s) => s.inspectionStandardCode === 'QS-SPHC-HR');
    if (sphcHr) sphcHr.steelGradeId = null;
    expect(computeMasterReadiness(shared).ready).toBe(true);
  });

  it('제강·연주 수율, 열연 공정, 원단위, 매핑, 기본 공급업체 누락을 찾는다. 제선 수율은 보지 않는다', () => {
    const tables = seedWithoutStandards();
    addAllStandards(tables);
    const coilSteel = tables.routing.find((r) => r.itemType === 'COIL' && r.processType === 'STEELMAKING');
    if (coilSteel) coilSteel.plannedYieldRate = null;
    tables.routing = tables.routing.filter((r) => !(r.itemType === 'COIL' && r.processType === 'HOT_ROLLING'));
    const ore = tables.item.find((i) => i.itemCode === 'ORE01');
    tables.specificConsumption = tables.specificConsumption.filter((c) => c.itemId !== ore?.id && c.steelGradeId !== gradeId(tables, 'SPHC'));
    if (ore) ore.defaultSupplierId = null;
    const firstMapping = tables.specMapping[0];
    tables.specMapping = tables.specMapping.slice(1);

    const messages = computeMasterReadiness(tables).problems.map((p) => `${p.area}: ${p.message}`);
    const slab = tables.item.find((i) => i.id === firstMapping.slabItemId)?.itemCode;
    const coil = tables.item.find((i) => i.id === firstMapping.coilItemId)?.itemCode;
    expect(messages).toEqual(
      expect.arrayContaining([
        'ROUTING: 코일 라우팅의 제강 계획 수율이 없어요',
        'ROUTING: 코일 라우팅에 열연 공정이 없어요',
        'SPECIFIC_CONSUMPTION: 철광석 원단위(용선 1t당)가 없어요',
        'SPECIFIC_CONSUMPTION: SPHC 합금철 원단위(용강 1t당)가 없어요',
        `SPEC_MAPPING: ${slab}의 대응 코일 규격이 없어요`,
        `SPEC_MAPPING: ${coil}의 대응 슬래브 규격이 없어요`,
        'DEFAULT_SUPPLIER: ORE01 철광석의 기본 공급업체가 없어요',
      ]),
    );
    expect(messages.some((m) => m.includes('제선'))).toBe(false);
  });

  it('대응 코일 중복과 범위 밖 수율을 표시한다', () => {
    const tables = seedWithoutStandards();
    addAllStandards(tables);
    const [first, second] = tables.specMapping;
    second.coilItemId = first.coilItemId;
    const slabCast = tables.routing.find((r) => r.itemType === 'SLAB' && r.processType === 'CONTINUOUS_CASTING');
    if (slabCast) slabCast.plannedYieldRate = '1.2000';
    const problems = computeMasterReadiness(tables).problems.map((p) => p.message);
    expect(problems.some((m) => m.includes('대응 코일로 중복 지정됐어요'))).toBe(true);
    expect(problems).toContain('슬래브 라우팅의 연주 계획 수율 1.2000은 0보다 크고 1 이하여야 해요');
  });
});
