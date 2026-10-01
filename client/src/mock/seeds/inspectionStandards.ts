// 검사 기준 시드 (REQ-QC-001·002, BP-QC-01, PLAN 8-1, docs/rework/ks-values.md). 버전 1, is_current = true.
// 코드: QS-{강종}-{공정} — ST 제강(히트 성분) · CC 연주(슬래브 표면·치수) · HR 열연(코일 치수·기계적 성질). 공정 약어는 가정값.
// - 제강: KS 성분 상한(C·Si·Mn·P·S, 하한 없음). SM 계열은 탄소당량 상한 0.47(두께 50mm 이하 값, PLAN 8-1 #3). SPHC는 Si 없음.
//   SM355C·D는 규격 시드가 없지만 KS 값이 있어 제강 기준만 넣는다.
// - 연주: KS에 없음 → 사내 규격 가정값(편차·표면 결함 깊이).
// - 열연: 항복강도·인장강도·연신율(두께 구간 초과~이하), 샤르피 27J 이상(SM 계열, 두께 6mm 초과), 두께 허용차(KS D 3500 표 5, 시드 코일 두께 행만),
//   너비 허용차 +25/0, 캠버 길이 2000mm당 5 이하. 코일 길이·표면 항목은 없다(PLAN 8-1 #2). SPHC는 항복강도 규정 없음.
import type { ProcessType, SteelGradeCode } from '@/codes';
import type { MockTx } from '@/mock/store';
import { insertRow } from '@/mock/store';

interface StandardItemSeed {
  code: string;
  name: string;
  unit: string | null;
  min: string | null;
  max: string | null;
  /** 적용 두께 구간: 초과 */
  minT?: string | null;
  /** 적용 두께 구간: 이하 */
  maxT?: string | null;
}

const PROCESS_SUFFIX: Record<Exclude<ProcessType, 'IRONMAKING'>, string> = { STEELMAKING: 'ST', CONTINUOUS_CASTING: 'CC', HOT_ROLLING: 'HR' };

export const inspectionStandardCodeOf = (steelGradeCode: string, processType: Exclude<ProcessType, 'IRONMAKING'>): string => `QS-${steelGradeCode}-${PROCESS_SUFFIX[processType]}`;

const pct = (code: string, name: string, max: string): StandardItemSeed => ({ code, name, unit: '%', min: null, max });

/** 제강 = 히트 성분 (ks-values.md 2장). SM355 C·Ceq는 50mm 이하 값. */
const STEELMAKING_ITEMS: Partial<Record<SteelGradeCode, StandardItemSeed[]>> = {
  SS275: [pct('C', '탄소(C)', '0.25'), pct('SI', '규소(Si)', '0.45'), pct('MN', '망간(Mn)', '1.40'), pct('P', '인(P)', '0.050'), pct('S', '황(S)', '0.050')],
  SM355A: [pct('C', '탄소(C)', '0.20'), pct('SI', '규소(Si)', '0.55'), pct('MN', '망간(Mn)', '1.60'), pct('P', '인(P)', '0.035'), pct('S', '황(S)', '0.035'), pct('CEQ', '탄소당량(Ceq)', '0.47')],
  SM355B: [pct('C', '탄소(C)', '0.18'), pct('SI', '규소(Si)', '0.55'), pct('MN', '망간(Mn)', '1.60'), pct('P', '인(P)', '0.030'), pct('S', '황(S)', '0.030'), pct('CEQ', '탄소당량(Ceq)', '0.47')],
  SM355C: [pct('C', '탄소(C)', '0.18'), pct('SI', '규소(Si)', '0.55'), pct('MN', '망간(Mn)', '1.60'), pct('P', '인(P)', '0.025'), pct('S', '황(S)', '0.025'), pct('CEQ', '탄소당량(Ceq)', '0.47')],
  SM355D: [pct('C', '탄소(C)', '0.18'), pct('SI', '규소(Si)', '0.55'), pct('MN', '망간(Mn)', '1.60'), pct('P', '인(P)', '0.020'), pct('S', '황(S)', '0.020'), pct('CEQ', '탄소당량(Ceq)', '0.47')],
  SPHC: [pct('C', '탄소(C)', '0.15'), pct('MN', '망간(Mn)', '0.60'), pct('P', '인(P)', '0.050'), pct('S', '황(S)', '0.050')],
};

/** 연주 = 슬래브 표면·치수 (KS 없음, 사내 규격 가정값). 치수는 규격 대비 편차로 잰다. */
const CASTING_ITEMS: StandardItemSeed[] = [
  { code: 'THICKNESS_DEV', name: '두께 편차', unit: 'mm', min: '-5.00', max: '5.00' },
  { code: 'WIDTH_DEV', name: '폭 편차', unit: 'mm', min: '-10.00', max: '10.00' },
  { code: 'LENGTH_DEV', name: '길이 편차', unit: 'mm', min: '-10.00', max: '30.00' },
  { code: 'SURFACE_DEFECT_DEPTH', name: '표면 결함 깊이', unit: 'mm', min: '0.00', max: '2.00' },
];

const N = 'N/mm²';
const yieldBands = (rows: [string | null, string | null, string][]): StandardItemSeed[] =>
  rows.map(([minT, maxT, min]) => ({ code: 'YIELD_STRENGTH', name: '항복강도', unit: N, min, max: null, minT, maxT }));
const elongationBands = (rows: [string | null, string | null, string][]): StandardItemSeed[] =>
  rows.map(([minT, maxT, min]) => ({ code: 'ELONGATION', name: '연신율', unit: '%', min, max: null, minT, maxT }));

/** 시드 코일 두께의 두께 허용차 (KS D 3500 표 5, 시드 코일 폭 1200~1600 칸). 표 5 구간은 이상~미만이지만 시드 두께가 경계가 아니라 초과~이하로 둔다. */
const COIL_DIMENSION_ITEMS: StandardItemSeed[] = [
  { code: 'THICKNESS_TOL', name: '두께 허용차', unit: 'mm', min: '-0.20', max: '0.20', minT: '2.00', maxT: '2.50' },
  { code: 'THICKNESS_TOL', name: '두께 허용차', unit: 'mm', min: '-0.28', max: '0.28', minT: '4.00', maxT: '5.00' },
  { code: 'THICKNESS_TOL', name: '두께 허용차', unit: 'mm', min: '-0.42', max: '0.42', minT: '8.00', maxT: '10.00' },
  { code: 'WIDTH_TOL', name: '너비 허용차', unit: 'mm', min: '0.00', max: '25.00' },
  { code: 'CAMBER', name: '캠버(길이 2000mm당)', unit: 'mm', min: null, max: '5.00' },
];

const SM_MECHANICAL: StandardItemSeed[] = [
  ...yieldBands([
    [null, '16.00', '355'],
    ['16.00', '40.00', '345'],
    ['40.00', '75.00', '335'],
    ['75.00', '100.00', '325'],
    ['100.00', '200.00', '305'],
  ]),
  { code: 'TENSILE_STRENGTH', name: '인장강도', unit: N, min: '490', max: '630' },
  ...elongationBands([
    [null, '5.00', '22'],
    ['5.00', '16.00', '17'],
    ['16.00', '40.00', '19'],
    ['40.00', null, '23'],
  ]),
];

const charpy = (temperature: string): StandardItemSeed => ({ code: 'CHARPY', name: `샤르피 흡수 에너지(${temperature})`, unit: 'J', min: '27', max: null, minT: '6.00', maxT: null });

const HOT_ROLLING_ITEMS: Partial<Record<SteelGradeCode, StandardItemSeed[]>> = {
  SS275: [
    ...yieldBands([
      [null, '16.00', '275'],
      ['16.00', '40.00', '265'],
      ['40.00', '100.00', '245'],
      ['100.00', null, '235'],
    ]),
    { code: 'TENSILE_STRENGTH', name: '인장강도', unit: N, min: '410', max: '550' },
    ...elongationBands([
      [null, '5.00', '21'],
      ['5.00', '16.00', '18'],
      ['16.00', '40.00', '21'],
      ['40.00', null, '23'],
    ]),
    ...COIL_DIMENSION_ITEMS,
  ],
  SM355A: [...SM_MECHANICAL, charpy('20℃'), ...COIL_DIMENSION_ITEMS],
  SM355B: [...SM_MECHANICAL, charpy('0℃'), ...COIL_DIMENSION_ITEMS],
  SPHC: [
    { code: 'TENSILE_STRENGTH', name: '인장강도', unit: N, min: '270', max: null },
    ...elongationBands([
      ['1.20', '1.60', '27'],
      ['1.60', '3.20', '29'],
      ['3.20', '14.00', '31'],
    ]),
    ...COIL_DIMENSION_ITEMS,
  ],
};

const SPEC_GRADES: readonly SteelGradeCode[] = ['SS275', 'SM355A', 'SM355B', 'SPHC'];

/** 검사 기준을 강종 × 공정마다 버전 1로 넣는다 */
export function seedInspectionStandards(tx: MockTx): void {
  const gradeId = (code: SteelGradeCode) => tx.tables.steelGrade.find((g) => g.steelGradeCode === code)?.id ?? null;
  const add = (grade: SteelGradeCode, processType: Exclude<ProcessType, 'IRONMAKING'>, items: readonly StandardItemSeed[]) => {
    const steelGradeId = gradeId(grade);
    if (steelGradeId === null) return;
    const standard = insertRow(tx, 'inspectionStandard', { inspectionStandardCode: inspectionStandardCodeOf(grade, processType), version: 1, processType, steelGradeId, isCurrent: true });
    items.forEach((item, index) =>
      insertRow(tx, 'inspectionStandardItem', {
        inspectionStandardId: standard.id,
        inspectionItemCode: item.code,
        inspectionItemName: item.name,
        unit: item.unit,
        minValue: item.min,
        maxValue: item.max,
        minThicknessMm: item.minT ?? null,
        maxThicknessMm: item.maxT ?? null,
        isRequired: true,
        sortOrder: index + 1,
      }),
    );
  };
  for (const grade of ['SS275', 'SM355A', 'SM355B', 'SM355C', 'SM355D', 'SPHC'] as const) {
    const items = STEELMAKING_ITEMS[grade];
    if (items) add(grade, 'STEELMAKING', items);
  }
  for (const grade of SPEC_GRADES) add(grade, 'CONTINUOUS_CASTING', CASTING_ITEMS);
  for (const grade of SPEC_GRADES) {
    const items = HOT_ROLLING_ITEMS[grade];
    if (items) add(grade, 'HOT_ROLLING', items);
  }
}

/** 화면에 'KS'·'가정값' 표시를 붙일 때 쓰는 출처 (항목 코드 기준) */
export const INSPECTION_ITEM_SOURCE: Record<string, 'KS' | 'ASSUMED'> = {
  C: 'KS',
  SI: 'KS',
  MN: 'KS',
  P: 'KS',
  S: 'KS',
  CEQ: 'KS',
  YIELD_STRENGTH: 'KS',
  TENSILE_STRENGTH: 'KS',
  ELONGATION: 'KS',
  CHARPY: 'KS',
  THICKNESS_TOL: 'KS',
  WIDTH_TOL: 'KS',
  CAMBER: 'KS',
  THICKNESS_DEV: 'ASSUMED',
  WIDTH_DEV: 'ASSUMED',
  LENGTH_DEV: 'ASSUMED',
  SURFACE_DEFECT_DEPTH: 'ASSUMED',
};
