import { PrismaService } from '../../prisma/prisma.service';
import { InspectionStandardRepository } from './inspection-standard.repository';
import { InspectionStandardService } from './inspection-standard.service';

// 실제 DB(npm test의 fs_prod)를 쓴다. 시드 기준(버전 1, 14개)은 바꾸지 않고, 버전 테스트는 이 파일에서 만든 강종으로만 한다.
describe('검사 기준 목록 조회 (API-221, REQ-QC-002)', () => {
  const prisma = new PrismaService();
  const service = new InspectionStandardService(prisma, new InspectionStandardRepository());
  let tempSteelGradeId: number;
  let v1Id: number;
  let v2Id: number;

  beforeAll(async () => {
    const grade = await prisma.steelGrade.create({
      data: { steelGradeCode: 'QSL-GRADE', steelGradeName: '검사 기준 목록 테스트 강종', standardNo: 'TEST' },
    });
    tempSteelGradeId = grade.id;
    const standard = (versionNo: number) =>
      prisma.inspectionStandard.create({
        data: { inspectionStandardCode: 'QS-QSL-GRADE-HR', versionNo, processType: 'HOT_ROLLING', steelGradeId: grade.id },
      });
    const v1 = await standard(1);
    const v2 = await standard(2);
    v1Id = v1.id;
    v2Id = v2.id;
    await prisma.inspectionStandardItem.create({
      data: { inspectionStandardId: v1.id, inspectionItemCode: 'TENSILE_STRENGTH', inspectionItemName: '인장강도', unit: 'MPa', minValue: '400' },
    });
    // v2: 인장강도 하한을 올리고 샤르피(6mm 초과)를 더함. 등록 순서대로 보여야 한다
    await prisma.inspectionStandardItem.create({
      data: {
        inspectionStandardId: v2.id,
        inspectionItemCode: 'TENSILE_STRENGTH',
        inspectionItemName: '인장강도',
        unit: 'MPa',
        minValue: '410',
        maxValue: '550.5',
      },
    });
    await prisma.inspectionStandardItem.create({
      data: {
        inspectionStandardId: v2.id,
        inspectionItemCode: 'CHARPY',
        inspectionItemName: '샤르피 충격',
        unit: 'J',
        minValue: '27',
        thicknessOverMm: '6',
        isRequired: false,
      },
    });
  });

  afterAll(async () => {
    await prisma.inspectionStandardItem.deleteMany({ where: { inspectionStandardId: { in: [v1Id, v2Id] } } });
    await prisma.inspectionStandard.deleteMany({ where: { id: { in: [v1Id, v2Id] } } });
    await prisma.steelGrade.delete({ where: { id: tempSteelGradeId } });
    await prisma.$disconnect();
  });

  it('공정·강종마다 최신 버전 하나만, 옛 버전은 넣지 않는다', async () => {
    const result = await service.listInspectionStandards({ steelGradeId: tempSteelGradeId });
    expect(result).toMatchObject({ page: 1, size: 20, total: 1 });
    expect(result.items[0]).toMatchObject({
      inspectionStandardId: v2Id,
      inspectionStandardCode: 'QS-QSL-GRADE-HR',
      versionNo: 2,
      processType: 'HOT_ROLLING',
      steelGradeId: tempSteelGradeId,
      steelGradeCode: 'QSL-GRADE',
    });
  });

  it('항목은 등록 순서대로 min/max(소수 4자리)·적용 두께 구간(소수 2자리)·필수 여부를 준다', async () => {
    const [standard] = (await service.listInspectionStandards({ steelGradeId: tempSteelGradeId })).items;
    expect(standard.items).toEqual([
      {
        inspectionStandardItemId: expect.any(Number),
        inspectionItemCode: 'TENSILE_STRENGTH',
        inspectionItemName: '인장강도',
        unit: 'MPa',
        minValue: '410.0000',
        maxValue: '550.5000',
        thicknessOverMm: null,
        thicknessUptoMm: null,
        isRequired: true,
      },
      {
        inspectionStandardItemId: expect.any(Number),
        inspectionItemCode: 'CHARPY',
        inspectionItemName: '샤르피 충격',
        unit: 'J',
        minValue: '27.0000',
        maxValue: null,
        thicknessOverMm: '6.00',
        thicknessUptoMm: null,
        isRequired: false,
      },
    ]);
  });

  it('공정 필터, 같은 공정 안에서는 강종 코드 순', async () => {
    const result = await service.listInspectionStandards({ processType: 'CONTINUOUS_CASTING' });
    expect(result.total).toBe(4);
    expect(result.items.map((s) => s.inspectionStandardCode)).toEqual(['QS-SM355A-CC', 'QS-SM355B-CC', 'QS-SPHC-CC', 'QS-SS275-CC']);
  });

  it('제강 기준의 항목이 강종 성분 규격이다 (TRM-020)', async () => {
    const result = await service.listInspectionStandards({ processType: 'STEELMAKING' });
    const sm355a = result.items.find((s) => s.steelGradeCode === 'SM355A');
    expect(sm355a?.items.map((i) => i.inspectionItemCode)).toEqual(['C', 'SI', 'MN', 'P', 'S', 'CEQ']);
  });

  it('필터가 없으면 공정 순서(제강 → 연주 → 열연)로 모두', async () => {
    const { items, total } = await service.listInspectionStandards({ size: 100 });
    const processes = items.map((s) => s.processType);
    expect(total).toBe(items.length);
    expect(processes.indexOf('CONTINUOUS_CASTING')).toBeGreaterThan(processes.lastIndexOf('STEELMAKING'));
    expect(processes.indexOf('HOT_ROLLING')).toBeGreaterThan(processes.lastIndexOf('CONTINUOUS_CASTING'));
  });

  it('page·size로 나누고 total은 전체 건수', async () => {
    const result = await service.listInspectionStandards({ processType: 'CONTINUOUS_CASTING', page: 2, size: 3 });
    expect(result).toMatchObject({ page: 2, size: 3, total: 4 });
    expect(result.items.map((s) => s.inspectionStandardCode)).toEqual(['QS-SS275-CC']);
  });

  it('조건에 맞는 기준이 없으면 빈 목록', async () => {
    const result = await service.listInspectionStandards({ processType: 'STEELMAKING', steelGradeId: tempSteelGradeId });
    expect(result).toMatchObject({ items: [], total: 0 });
  });
});

describe('검사 기준 상세 조회 (API-120, REQ-QC-002)', () => {
  const prisma = new PrismaService();
  const service = new InspectionStandardService(prisma, new InspectionStandardRepository());
  let tempSteelGradeId: number;
  let v1Id: number;
  let v2Id: number;

  beforeAll(async () => {
    const grade = await prisma.steelGrade.create({
      data: { steelGradeCode: 'QSD-GRADE', steelGradeName: '검사 기준 상세 테스트 강종', standardNo: 'TEST' },
    });
    tempSteelGradeId = grade.id;
    const standard = (versionNo: number) =>
      prisma.inspectionStandard.create({
        data: { inspectionStandardCode: 'QS-QSD-GRADE-HR', versionNo, processType: 'HOT_ROLLING', steelGradeId: grade.id },
      });
    const v1 = await standard(1);
    const v2 = await standard(2);
    v1Id = v1.id;
    v2Id = v2.id;
    await prisma.inspectionStandardItem.create({
      data: { inspectionStandardId: v1.id, inspectionItemCode: 'TENSILE_STRENGTH', inspectionItemName: '인장강도', unit: 'MPa', minValue: '400' },
    });
    await prisma.inspectionStandardItem.createMany({
      data: [
        { inspectionStandardId: v2.id, inspectionItemCode: 'TENSILE_STRENGTH', inspectionItemName: '인장강도', unit: 'MPa', minValue: '410' },
        {
          inspectionStandardId: v2.id,
          inspectionItemCode: 'YIELD_STRENGTH',
          inspectionItemName: '항복강도',
          unit: 'MPa',
          minValue: '345',
          thicknessOverMm: '16',
          thicknessUptoMm: '40',
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.inspectionStandardItem.deleteMany({ where: { inspectionStandardId: { in: [v1Id, v2Id] } } });
    await prisma.inspectionStandard.deleteMany({ where: { id: { in: [v1Id, v2Id] } } });
    await prisma.steelGrade.delete({ where: { id: tempSteelGradeId } });
    await prisma.$disconnect();
  });

  it('기준 버전 1건과 항목의 단위·min/max·적용 두께 구간·필수 여부를 준다', async () => {
    const detail = await service.getInspectionStandard(v2Id);
    expect(detail).toMatchObject({
      inspectionStandardId: v2Id,
      inspectionStandardCode: 'QS-QSD-GRADE-HR',
      versionNo: 2,
      processType: 'HOT_ROLLING',
      steelGradeId: tempSteelGradeId,
      steelGradeCode: 'QSD-GRADE',
    });
    expect(detail.items.map((i) => [i.inspectionItemCode, i.unit, i.minValue, i.maxValue, i.thicknessOverMm, i.thicknessUptoMm, i.isRequired])).toEqual([
      ['TENSILE_STRENGTH', 'MPa', '410.0000', null, null, null, true],
      ['YIELD_STRENGTH', 'MPa', '345.0000', null, '16.00', '40.00', true],
    ]);
  });

  it('옛 버전도 그 버전의 항목 그대로 보여 준다 (검사 기록이 참조하는 버전)', async () => {
    const detail = await service.getInspectionStandard(v1Id);
    expect(detail).toMatchObject({ inspectionStandardId: v1Id, versionNo: 1 });
    expect(detail.items.map((i) => [i.inspectionItemCode, i.minValue])).toEqual([['TENSILE_STRENGTH', '400.0000']]);
  });

  it('제강 기준은 강종 성분 규격 항목을 준다 (TRM-020)', async () => {
    const seed = await prisma.inspectionStandard.findUniqueOrThrow({
      where: { inspectionStandardCode_versionNo: { inspectionStandardCode: 'QS-SM355A-ST', versionNo: 1 } },
    });
    const detail = await service.getInspectionStandard(seed.id);
    expect(detail).toMatchObject({ processType: 'STEELMAKING', steelGradeCode: 'SM355A' });
    expect(detail.items.map((i) => i.inspectionItemCode)).toEqual(['C', 'SI', 'MN', 'P', 'S', 'CEQ']);
  });

  it('없는 기준 id는 COM-003', async () => {
    await expect(service.getInspectionStandard(2_000_000_000)).rejects.toMatchObject({ code: 'COM-003' });
  });
});
