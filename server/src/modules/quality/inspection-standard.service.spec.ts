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

describe('검사 기준 등록 (API-121, REQ-QC-002)', () => {
  const prisma = new PrismaService();
  const service = new InspectionStandardService(prisma, new InspectionStandardRepository());
  let tempSteelGradeId: number;

  const hotRollingItems = () => [
    { inspectionItemCode: 'TENSILE_STRENGTH', inspectionItemName: '인장강도', unit: 'MPa', minValue: '490', maxValue: '630' },
    { inspectionItemCode: 'YIELD_STRENGTH', inspectionItemName: '항복강도', unit: 'MPa', minValue: '355', thicknessUptoMm: '16' },
    { inspectionItemCode: 'YIELD_STRENGTH', inspectionItemName: '항복강도', unit: 'MPa', minValue: '345', thicknessOverMm: '16', thicknessUptoMm: '40' },
    { inspectionItemCode: 'CHARPY', inspectionItemName: '샤르피 충격', unit: 'J', minValue: '27', thicknessOverMm: '6', isRequired: false },
    { inspectionItemCode: 'THICKNESS_TOL', inspectionItemName: '두께 허용차', unit: 'mm', minValue: '-0.42', maxValue: '0.42' },
  ];

  beforeAll(async () => {
    const grade = await prisma.steelGrade.create({
      data: { steelGradeCode: 'QSC-GRADE', steelGradeName: '검사 기준 등록 테스트 강종', standardNo: 'TEST' },
    });
    tempSteelGradeId = grade.id;
  });

  afterAll(async () => {
    const standards = await prisma.inspectionStandard.findMany({ where: { steelGradeId: tempSteelGradeId }, select: { id: true } });
    const ids = standards.map((s) => s.id);
    await prisma.inspectionStandardItem.deleteMany({ where: { inspectionStandardId: { in: ids } } });
    await prisma.inspectionStandard.deleteMany({ where: { id: { in: ids } } });
    await prisma.steelGrade.delete({ where: { id: tempSteelGradeId } });
    await prisma.$disconnect();
  });

  it('버전 1로 만들고 코드는 QS-{강종}-{공정 약어}, 응답은 등록된 기준 상세', async () => {
    const detail = await service.createInspectionStandard({
      processType: 'HOT_ROLLING',
      steelGradeId: tempSteelGradeId,
      items: hotRollingItems(),
    });
    expect(detail).toMatchObject({
      inspectionStandardCode: 'QS-QSC-GRADE-HR',
      versionNo: 1,
      processType: 'HOT_ROLLING',
      steelGradeId: tempSteelGradeId,
      steelGradeCode: 'QSC-GRADE',
    });
    expect(detail.items.map((i) => [i.inspectionItemCode, i.minValue, i.maxValue, i.thicknessOverMm, i.thicknessUptoMm, i.isRequired])).toEqual([
      ['TENSILE_STRENGTH', '490.0000', '630.0000', null, null, true],
      ['YIELD_STRENGTH', '355.0000', null, null, '16.00', true],
      ['YIELD_STRENGTH', '345.0000', null, '16.00', '40.00', true],
      ['CHARPY', '27.0000', null, '6.00', null, false],
      ['THICKNESS_TOL', '-0.4200', '0.4200', null, null, true],
    ]);
    // 등록한 기준은 목록의 최신 버전으로 나온다
    const list = await service.listInspectionStandards({ steelGradeId: tempSteelGradeId });
    expect(list.items.map((s) => s.inspectionStandardId)).toEqual([detail.inspectionStandardId]);
  });

  it('제강 기준(강종 성분 규격)은 같은 강종이라도 공정이 달라 따로 등록된다', async () => {
    const detail = await service.createInspectionStandard({
      processType: 'STEELMAKING',
      steelGradeId: tempSteelGradeId,
      items: [
        { inspectionItemCode: 'C', inspectionItemName: '탄소', unit: '%', maxValue: '0.2' },
        { inspectionItemCode: 'MN', inspectionItemName: '망간', unit: '%', maxValue: '1.6', isRequired: true },
      ],
    });
    expect(detail).toMatchObject({ inspectionStandardCode: 'QS-QSC-GRADE-ST', versionNo: 1, processType: 'STEELMAKING' });
  });

  it('같은 공정·강종에 기준이 이미 있으면 COM-004 (새 버전으로 고치도록 안내)', async () => {
    await expect(
      service.createInspectionStandard({ processType: 'HOT_ROLLING', steelGradeId: tempSteelGradeId, items: hotRollingItems() }),
    ).rejects.toMatchObject({ code: 'COM-004', message: expect.stringContaining('QS-QSC-GRADE-HR') });
    expect(await prisma.inspectionStandard.count({ where: { steelGradeId: tempSteelGradeId, processType: 'HOT_ROLLING' } })).toBe(1);
  });

  it('항목이 맞지 않으면(두께 구간 겹침) COM-004, 아무것도 저장하지 않는다', async () => {
    await expect(
      service.createInspectionStandard({
        processType: 'CONTINUOUS_CASTING',
        steelGradeId: tempSteelGradeId,
        items: [
          { inspectionItemCode: 'WIDTH_TOL', inspectionItemName: '폭 허용차', minValue: '0', maxValue: '10' },
          { inspectionItemCode: 'WIDTH_TOL', inspectionItemName: '폭 허용차', minValue: '0', maxValue: '20' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'COM-004' });
    expect(await prisma.inspectionStandard.count({ where: { steelGradeId: tempSteelGradeId, processType: 'CONTINUOUS_CASTING' } })).toBe(0);
  });

  it('없는 강종은 COM-003', async () => {
    await expect(
      service.createInspectionStandard({ processType: 'HOT_ROLLING', steelGradeId: 2_000_000_000, items: hotRollingItems() }),
    ).rejects.toMatchObject({ code: 'COM-003' });
  });
});

describe('검사 기준 수정 = 새 버전 (API-122, REQ-QC-002)', () => {
  const prisma = new PrismaService();
  const service = new InspectionStandardService(prisma, new InspectionStandardRepository());
  let tempSteelGradeId: number;
  let v1Id: number;
  let v2Id: number;

  const itemsOf = async (inspectionStandardId: number) =>
    prisma.inspectionStandardItem.findMany({
      where: { inspectionStandardId },
      orderBy: { id: 'asc' },
      select: { inspectionItemCode: true, minValue: true, maxValue: true },
    });

  beforeAll(async () => {
    const grade = await prisma.steelGrade.create({
      data: { steelGradeCode: 'QSV-GRADE', steelGradeName: '검사 기준 새 버전 테스트 강종', standardNo: 'TEST' },
    });
    tempSteelGradeId = grade.id;
    const v1 = await service.createInspectionStandard({
      processType: 'HOT_ROLLING',
      steelGradeId: grade.id,
      items: [
        { inspectionItemCode: 'TENSILE_STRENGTH', inspectionItemName: '인장강도', unit: 'MPa', minValue: '400', maxValue: '510' },
        { inspectionItemCode: 'CAMBER', inspectionItemName: '캠버', unit: 'mm', maxValue: '5' },
      ],
    });
    v1Id = v1.inspectionStandardId;
  });

  afterAll(async () => {
    const standards = await prisma.inspectionStandard.findMany({ where: { steelGradeId: tempSteelGradeId }, select: { id: true } });
    const ids = standards.map((s) => s.id);
    await prisma.inspectionStandardItem.deleteMany({ where: { inspectionStandardId: { in: ids } } });
    await prisma.inspectionStandard.deleteMany({ where: { id: { in: ids } } });
    await prisma.steelGrade.delete({ where: { id: tempSteelGradeId } });
    await prisma.$disconnect();
  });

  it('같은 코드·공정·강종으로 version_no + 1을 만들고 새 항목 전체를 넣는다', async () => {
    const v2 = await service.createInspectionStandardVersion(v1Id, {
      items: [
        { inspectionItemCode: 'TENSILE_STRENGTH', inspectionItemName: '인장강도', unit: 'MPa', minValue: '410', maxValue: '550' },
        { inspectionItemCode: 'CHARPY', inspectionItemName: '샤르피 충격', unit: 'J', minValue: '27', thicknessOverMm: '6' },
      ],
    });
    v2Id = v2.inspectionStandardId;
    expect(v2).toMatchObject({
      inspectionStandardCode: 'QS-QSV-GRADE-HR',
      versionNo: 2,
      processType: 'HOT_ROLLING',
      steelGradeId: tempSteelGradeId,
    });
    expect(v2Id).not.toBe(v1Id);
    expect(v2.items.map((i) => [i.inspectionItemCode, i.minValue, i.maxValue, i.thicknessOverMm])).toEqual([
      ['TENSILE_STRENGTH', '410.0000', '550.0000', null],
      ['CHARPY', '27.0000', null, '6.00'],
    ]);
  });

  it('기존 버전과 항목은 그대로 남는다 (수정·삭제하지 않음, [05] 7-2)', async () => {
    const v1 = await service.getInspectionStandard(v1Id);
    expect(v1).toMatchObject({ versionNo: 1, inspectionStandardCode: 'QS-QSV-GRADE-HR' });
    expect((await itemsOf(v1Id)).map((i) => [i.inspectionItemCode, i.minValue?.toString() ?? null, i.maxValue?.toString() ?? null])).toEqual([
      ['TENSILE_STRENGTH', '400', '510'],
      ['CAMBER', null, '5'],
    ]);
  });

  it('상세는 같은 코드의 버전 이력(버전 순)과 버전별 항목 수·판정한 검사 수를 준다 (옛 버전 상세도 같다)', async () => {
    for (const id of [v1Id, v2Id]) {
      const detail = await service.getInspectionStandard(id);
      expect(detail.versions.map((v) => [v.inspectionStandardId, v.versionNo, v.itemCount, v.inspectionCount])).toEqual([
        [v1Id, 1, 2, 0],
        [v2Id, 2, 2, 0],
      ]);
      expect(detail.inspectionCount).toBe(0);
    }
  });

  it('목록에는 새 버전이 최신으로 나온다 (이후 검사는 새 버전으로 판정)', async () => {
    const list = await service.listInspectionStandards({ steelGradeId: tempSteelGradeId });
    expect(list.items.map((s) => [s.inspectionStandardId, s.versionNo])).toEqual([[v2Id, 2]]);
  });

  it('최신이 아닌 버전에서 만들면 COM-001, 새 행을 만들지 않는다', async () => {
    await expect(
      service.createInspectionStandardVersion(v1Id, {
        items: [{ inspectionItemCode: 'TENSILE_STRENGTH', inspectionItemName: '인장강도', minValue: '420' }],
      }),
    ).rejects.toMatchObject({ code: 'COM-001', message: expect.stringContaining('버전 2') });
    expect(await prisma.inspectionStandard.count({ where: { steelGradeId: tempSteelGradeId } })).toBe(2);
  });

  it('항목이 맞지 않으면(min > max) COM-004, 새 행을 만들지 않는다', async () => {
    await expect(
      service.createInspectionStandardVersion(v2Id, {
        items: [{ inspectionItemCode: 'TENSILE_STRENGTH', inspectionItemName: '인장강도', minValue: '600', maxValue: '500' }],
      }),
    ).rejects.toMatchObject({ code: 'COM-004' });
    expect(await prisma.inspectionStandard.count({ where: { steelGradeId: tempSteelGradeId } })).toBe(2);
  });

  it('없는 기준 id는 COM-003', async () => {
    await expect(
      service.createInspectionStandardVersion(2_000_000_000, {
        items: [{ inspectionItemCode: 'C', inspectionItemName: '탄소', maxValue: '0.2' }],
      }),
    ).rejects.toMatchObject({ code: 'COM-003' });
  });
});

describe('검사 기준 삭제 (REQ-QC-002, SPEC 5장 "참조가 있으면 거부")', () => {
  const prisma = new PrismaService();
  const service = new InspectionStandardService(prisma, new InspectionStandardRepository());
  let tempSteelGradeId: number;
  let lotId: number;
  let resultId: number;

  const items = [{ inspectionItemCode: 'CAMBER', inspectionItemName: '캠버', unit: 'mm', maxValue: '5' }];
  const create = (processType: 'HOT_ROLLING' | 'CONTINUOUS_CASTING') => service.createInspectionStandard({ processType, steelGradeId: tempSteelGradeId, items });
  const versionsOf = (inspectionStandardCode: string) => prisma.inspectionStandard.findMany({ where: { inspectionStandardCode } });

  beforeAll(async () => {
    const grade = await prisma.steelGrade.create({
      data: { steelGradeCode: 'QSD-GRADE', steelGradeName: '검사 기준 삭제 테스트 강종', standardNo: 'TEST' },
    });
    tempSteelGradeId = grade.id;
    const result = await prisma.productionResult.create({ data: { processType: 'STEELMAKING', converterCode: 'BOF1', startedAt: new Date() } });
    resultId = result.id;
    lotId = (await prisma.lot.create({ data: { lotNo: 'QSD-H', lotType: 'HEAT', steelGradeId: grade.id, productionResultId: result.id } })).id;
  });

  afterAll(async () => {
    await prisma.qualityInspection.deleteMany({ where: { lotId } });
    await prisma.lot.delete({ where: { id: lotId } });
    await prisma.productionResult.delete({ where: { id: resultId } });
    const standards = await prisma.inspectionStandard.findMany({ where: { steelGradeId: tempSteelGradeId }, select: { id: true } });
    const ids = standards.map((s) => s.id);
    await prisma.inspectionStandardItem.deleteMany({ where: { inspectionStandardId: { in: ids } } });
    await prisma.inspectionStandard.deleteMany({ where: { id: { in: ids } } });
    await prisma.steelGrade.delete({ where: { id: tempSteelGradeId } });
    await prisma.$disconnect();
  });

  it('검사가 쓰지 않은 기준은 그 코드의 모든 버전과 항목을 지운다 (아무 버전 id로 불러도 같다)', async () => {
    const v1 = await create('HOT_ROLLING');
    const v2 = await service.createInspectionStandardVersion(v1.inspectionStandardId, { items });

    const result = await service.deleteInspectionStandard(v1.inspectionStandardId);

    expect(result).toEqual({ inspectionStandardCode: 'QS-QSD-GRADE-HR', deletedVersionNos: [1, 2] });
    expect(await versionsOf('QS-QSD-GRADE-HR')).toEqual([]);
    expect(await prisma.inspectionStandardItem.count({ where: { inspectionStandardId: { in: [v1.inspectionStandardId, v2.inspectionStandardId] } } })).toBe(0);
  });

  it('지운 뒤에는 같은 공정·강종에 다시 버전 1로 등록할 수 있다', async () => {
    const again = await create('HOT_ROLLING');
    expect(again).toMatchObject({ inspectionStandardCode: 'QS-QSD-GRADE-HR', versionNo: 1 });
  });

  it('어느 버전이든 검사가 판정에 썼으면 COM-004로 거부하고 아무것도 지우지 않는다', async () => {
    const v1 = await create('CONTINUOUS_CASTING');
    const v2 = await service.createInspectionStandardVersion(v1.inspectionStandardId, { items });
    const inspector = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2205013' } });
    await prisma.qualityInspection.create({
      data: { lotId, inspectionStandardId: v1.inspectionStandardId, inspectorEmployeeId: inspector.id, inspectedAt: new Date(), inspectionResult: 'PASS' },
    });

    await expect(service.deleteInspectionStandard(v2.inspectionStandardId)).rejects.toMatchObject({ code: 'COM-004' });
    expect((await versionsOf('QS-QSD-GRADE-CC')).map((v) => v.versionNo).sort()).toEqual([1, 2]);
    // 상세의 판정한 검사 수: 검사가 쓴 v1만 1건
    const detail = await service.getInspectionStandard(v2.inspectionStandardId);
    expect(detail.inspectionCount).toBe(0);
    expect(detail.versions.map((v) => [v.versionNo, v.inspectionCount])).toEqual([
      [1, 1],
      [2, 0],
    ]);
  });

  it('없는 기준 id는 COM-003', async () => {
    await expect(service.deleteInspectionStandard(2_000_000_000)).rejects.toMatchObject({ code: 'COM-003' });
  });
});
