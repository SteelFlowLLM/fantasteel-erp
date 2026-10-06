import { Prisma } from '../../generated/prisma/client';
import { lotTypesForProcess, pickLatestStandards, toQualityInspectionListItem } from './quality-inspection-list';
import type { QualityInspectionListLot } from './quality.repository';

const grade = { id: 2, steelGradeCode: 'SM355A' };
const standards = [
  { id: 10, inspectionStandardCode: 'QS-SM355A-ST', versionNo: 1, processType: 'STEELMAKING', steelGradeId: 2 },
  { id: 30, inspectionStandardCode: 'QS-SM355A-ST', versionNo: 2, processType: 'STEELMAKING', steelGradeId: 2 },
  { id: 11, inspectionStandardCode: 'QS-SM355A-HR', versionNo: 1, processType: 'HOT_ROLLING', steelGradeId: 2 },
];

const heatLot = (overrides: Partial<QualityInspectionListLot> = {}): QualityInspectionListLot => ({
  id: 1,
  lotNo: 'H260101-BOF1-01',
  lotType: 'HEAT',
  lotStatus: 'AVAILABLE',
  producedDate: null,
  productionResult: { productionPlan: { id: 5, productionPlanNo: 'PP-2610-0001' } },
  steelGrade: grade,
  item: null,
  qualityInspection: null,
  lotRelationsAsChildLot: [],
  ...overrides,
});

const coilLot = (heatResult: string | null): QualityInspectionListLot => ({
  id: 3,
  lotNo: 'CS1',
  lotType: 'COIL',
  lotStatus: 'SHIPPED',
  producedDate: new Date('2026-10-03T00:00:00.000Z'),
  productionResult: null,
  steelGrade: null,
  item: { id: 40, itemCode: 'CL-SM355A-9x1500', itemName: '열연코일 SM355A 9x1500', thicknessMm: new Prisma.Decimal('9'), steelGrade: grade },
  qualityInspection: null,
  lotRelationsAsChildLot: [
    {
      parentLot: {
        id: 2,
        lotNo: 'S1',
        lotType: 'SLAB',
        qualityInspection: { inspectionResult: 'PASS' },
        lotRelationsAsChildLot: [
          { parentLot: { id: 1, lotNo: 'H1', qualityInspection: heatResult ? { inspectionResult: heatResult } : null } },
        ],
      },
    },
  ],
});

describe('공정 → LOT 유형 (REQ-QC-001)', () => {
  it('공정이 없으면 히트·슬래브·코일 전부', () => {
    expect(lotTypesForProcess()).toEqual(['HEAT', 'SLAB', 'COIL']);
  });
  it('제강 = 히트, 연주 = 슬래브, 열연 = 코일', () => {
    expect(lotTypesForProcess('STEELMAKING')).toEqual(['HEAT']);
    expect(lotTypesForProcess('CONTINUOUS_CASTING')).toEqual(['SLAB']);
    expect(lotTypesForProcess('HOT_ROLLING')).toEqual(['COIL']);
  });
});

describe('최신 기준 버전 고르기 (quality.md 4장)', () => {
  it('공정·강종마다 version_no가 가장 큰 기준', () => {
    const latest = pickLatestStandards(standards);
    expect(latest.get('STEELMAKING:2')?.versionNo).toBe(2);
    expect(latest.get('HOT_ROLLING:2')?.id).toBe(11);
    expect(latest.size).toBe(2);
  });
});

describe('검사 목록 행 만들기', () => {
  const latest = pickLatestStandards(standards);

  it('검사 행이 없는 히트는 지금 적용될 최신 기준을 보여 주고 판정·검사일은 비운다', () => {
    const row = toQualityInspectionListItem(heatLot(), latest);
    expect(row).toMatchObject({
      qualityInspectionId: null,
      processType: 'STEELMAKING',
      steelGradeCode: 'SM355A',
      thicknessMm: null,
      heatLotId: null,
      inspectionStandardId: 30,
      versionNo: 2,
      inspectionResult: null,
      inspectedAt: null,
    });
  });

  it('검사 행이 있으면 판정에 쓴 기준 버전을 그대로 쓴다', () => {
    const inspectedAt = new Date('2026-10-02T01:00:00.000Z');
    const row = toQualityInspectionListItem(
      heatLot({
        qualityInspection: {
          id: 7,
          inspectionResult: 'PASS',
          inspectedAt,
          inspectionStandard: { id: 10, inspectionStandardCode: 'QS-SM355A-ST', versionNo: 1 },
        },
      }),
      latest,
    );
    expect(row).toMatchObject({ qualityInspectionId: 7, inspectionStandardId: 10, versionNo: 1, inspectionResult: 'PASS' });
    expect(row.inspectedAt).toBe('2026-10-02T01:00:00.000Z');
  });

  it('코일은 슬래브를 거쳐 상위 히트와 그 판정을 찾고, 두께는 규격 두께 소수 2자리', () => {
    const row = toQualityInspectionListItem(coilLot('FAIL'), latest);
    expect(row).toMatchObject({
      processType: 'HOT_ROLLING',
      thicknessMm: '9.00',
      heatLotId: 1,
      heatLotNo: 'H1',
      heatInspectionResult: 'FAIL',
      inspectionStandardCode: 'QS-SM355A-HR',
    });
  });

  it('LOT 상태·규격·생산완료일·생산계획을 같이 준다. 히트는 규격·생산완료일이 없고, 계획 없는 실적이면 계획은 null', () => {
    expect(toQualityInspectionListItem(heatLot(), latest)).toMatchObject({
      lotStatus: 'AVAILABLE',
      itemId: null,
      itemCode: null,
      producedDate: null,
      productionPlanId: 5,
      productionPlanNo: 'PP-2610-0001',
    });
    expect(toQualityInspectionListItem(coilLot('PASS'), latest)).toMatchObject({
      lotStatus: 'SHIPPED',
      itemId: 40,
      itemCode: 'CL-SM355A-9x1500',
      itemName: '열연코일 SM355A 9x1500',
      producedDate: '2026-10-03',
      productionPlanId: null,
      productionPlanNo: null,
    });
  });

  it('상위 히트에 검사 행이 없으면 히트 판정은 null', () => {
    expect(toQualityInspectionListItem(coilLot(null), latest).heatInspectionResult).toBeNull();
  });

  it('그 공정·강종의 기준이 없으면 기준은 null', () => {
    const row = toQualityInspectionListItem(heatLot({ steelGrade: { id: 99, steelGradeCode: 'SM355C' } }), latest);
    expect(row).toMatchObject({ inspectionStandardId: null, inspectionStandardCode: null, versionNo: null });
  });
});
