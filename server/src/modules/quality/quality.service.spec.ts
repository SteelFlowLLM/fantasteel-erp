import type { AuthUser } from '@fantasteel/shared';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { NumberingRepository } from '../../common/numbering/numbering.repository';
import { NumberingService } from '../../common/numbering/numbering.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QualityRepository } from './quality.repository';
import { QualityService } from './quality.service';

const recorder = new BusinessEventRecorder(new NumberingService(new NumberingRepository()));

// 실제 DB(npm test의 fs_prod)를 쓴다. 다른 테스트의 LOT과 섞이지 않도록 이 파일의 LOT 번호는 모두 PREFIX로 시작한다.
const PREFIX = 'QT-';

describe('검사 대기·검사 목록 조회 (API-125, REQ-QC-001)', () => {
  const prisma = new PrismaService();
  const service = new QualityService(prisma, new QualityRepository(), recorder);
  const lotIds: number[] = [];
  const resultIds: number[] = [];
  const standardIds: number[] = [];
  let lots: Record<string, number>;
  let standardV1Id: number;

  const list = (query: Parameters<QualityService['listQualityInspections']>[0] = {}) =>
    service.listQualityInspections({ lotNo: PREFIX, ...query });
  const lotNosOf = async (query: Parameters<typeof list>[0] = {}) => (await list(query)).items.map((row) => row.lotNo);

  beforeAll(async () => {
    const grade = await prisma.steelGrade.findUniqueOrThrow({ where: { steelGradeCode: 'SM355A' } });
    const slabItem = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SM355A-250x1500x10000' } });
    const coilItem = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'CL-SM355A-9x1400x227500' } });
    const inspector = await prisma.employee.findFirstOrThrow({ select: { id: true } });
    const standardV1 = await prisma.inspectionStandard.findUniqueOrThrow({
      where: { inspectionStandardCode_versionNo: { inspectionStandardCode: 'QS-SM355A-ST', versionNo: 1 } },
    });
    const slabStandard = await prisma.inspectionStandard.findFirstOrThrow({
      where: { inspectionStandardCode: 'QS-SM355A-CC' },
    });
    standardV1Id = standardV1.id;

    const result = async (processType: string) => {
      const created = await prisma.productionResult.create({
        data: { processType, converterCode: processType === 'STEELMAKING' ? 'BOF1' : null, startedAt: new Date() },
      });
      resultIds.push(created.id);
      return created.id;
    };
    const steelmaking = await result('STEELMAKING');
    const casting = await result('CONTINUOUS_CASTING');
    const rolling = await result('HOT_ROLLING');
    const producedDate = new Date('2026-10-02');

    const heat = async (lotNo: string) =>
      prisma.lot.create({ data: { lotNo: PREFIX + lotNo, lotType: 'HEAT', steelGradeId: grade.id, productionResultId: steelmaking } });
    const product = async (lotNo: string, lotType: 'SLAB' | 'COIL', parentLotId: number) => {
      const lot = await prisma.lot.create({
        data: {
          lotNo: PREFIX + lotNo,
          lotType,
          itemId: lotType === 'SLAB' ? slabItem.id : coilItem.id,
          productionResultId: lotType === 'SLAB' ? casting : rolling,
          producedDate,
        },
      });
      await prisma.lotRelation.create({
        data: { parentLotId, childLotId: lot.id, lotRelationEvidence: 'ACTUAL_INPUT' },
      });
      return lot;
    };
    const inspect = (lotId: number, inspectionStandardId: number, inspectionResult: string, inspectedAt: string) =>
      prisma.qualityInspection.create({
        data: { lotId, inspectionStandardId, inspectionResult, inspectorEmployeeId: inspector.id, inspectedAt: new Date(inspectedAt) },
      });

    // 히트 3개: 미검사 / 불합격 / 합격
    const heatNew = await heat('H-NEW');
    const heatFail = await heat('H-FAIL');
    const heatPass = await heat('H-PASS');
    // 불합격 히트의 하위 슬래브·코일 (검사 대기에서 빠져야 함)
    const slabUnderFail = await product('S-UNDER-FAIL', 'SLAB', heatFail.id);
    const coilUnderFail = await product('C-UNDER-FAIL', 'COIL', slabUnderFail.id);
    // 합격 히트의 하위: 슬래브 PENDING, 코일 미검사
    const slabPending = await product('S-PENDING', 'SLAB', heatPass.id);
    const coilNew = await product('C-NEW', 'COIL', slabPending.id);

    await inspect(heatFail.id, standardV1.id, 'FAIL', '2026-10-02T01:00:00Z');
    await inspect(heatPass.id, standardV1.id, 'PASS', '2026-10-02T02:00:00Z');
    await inspect(slabPending.id, slabStandard.id, 'PENDING', '2026-10-02T03:00:00Z');

    lots = {
      heatNew: heatNew.id,
      heatFail: heatFail.id,
      heatPass: heatPass.id,
      slabUnderFail: slabUnderFail.id,
      coilUnderFail: coilUnderFail.id,
      slabPending: slabPending.id,
      coilNew: coilNew.id,
    };
    lotIds.push(...Object.values(lots));
  });

  afterAll(async () => {
    await prisma.qualityInspection.deleteMany({ where: { lotId: { in: lotIds } } });
    await prisma.lotRelation.deleteMany({ where: { childLotId: { in: lotIds } } });
    await prisma.lot.deleteMany({ where: { id: { in: lotIds } } });
    await prisma.productionResult.deleteMany({ where: { id: { in: resultIds } } });
    await prisma.inspectionStandard.deleteMany({ where: { id: { in: standardIds } } });
    await prisma.$disconnect();
  });

  it('기본(검사 대기)은 검사 행이 없거나 PENDING인 LOT, 상위 히트가 불합격인 슬래브·코일은 뺀다', async () => {
    expect(await lotNosOf()).toEqual([PREFIX + 'H-NEW', PREFIX + 'S-PENDING', PREFIX + 'C-NEW']);
  });

  it('검사 대기 행에 상위 히트와 그 판정, 규격 두께를 준다', async () => {
    const coil = (await list()).items.find((row) => row.lotId === lots.coilNew);
    expect(coil).toMatchObject({
      qualityInspectionId: null,
      processType: 'HOT_ROLLING',
      steelGradeCode: 'SM355A',
      thicknessMm: '9.00',
      heatLotId: lots.heatPass,
      heatInspectionResult: 'PASS',
      inspectionStandardCode: 'QS-SM355A-HR',
      versionNo: 1,
      inspectionResult: null,
    });
    const slab = (await list()).items.find((row) => row.lotId === lots.slabPending);
    expect(slab).toMatchObject({ inspectionResult: 'PENDING', inspectionStandardCode: 'QS-SM355A-CC', thicknessMm: '250.00' });
  });

  it('done은 PASS·FAIL 검사만, 최근 검사부터', async () => {
    expect(await lotNosOf({ status: 'done' })).toEqual([PREFIX + 'H-PASS', PREFIX + 'H-FAIL']);
  });

  it('판정 필터 inspectionResult로 불합격만 볼 수 있다', async () => {
    expect(await lotNosOf({ status: 'done', inspectionResult: 'FAIL' })).toEqual([PREFIX + 'H-FAIL']);
  });

  it('판정 필터를 검사 대기에 쓰면 COM-004', async () => {
    await expect(list({ inspectionResult: 'FAIL' })).rejects.toMatchObject({ code: 'COM-004' });
  });

  it('공정 필터는 LOT 유형으로 거른다', async () => {
    expect(await lotNosOf({ processType: 'STEELMAKING' })).toEqual([PREFIX + 'H-NEW']);
    expect(await lotNosOf({ processType: 'CONTINUOUS_CASTING' })).toEqual([PREFIX + 'S-PENDING']);
  });

  it('LOT id·LOT 번호(앞부분)로 거른다', async () => {
    expect(await lotNosOf({ lotId: lots.coilNew })).toEqual([PREFIX + 'C-NEW']);
    expect(await lotNosOf({ lotNo: PREFIX + 'S-' })).toEqual([PREFIX + 'S-PENDING']);
  });

  it('page·size로 나누고 total은 전체 건수', async () => {
    const page2 = await list({ page: 2, size: 2 });
    expect(page2).toMatchObject({ page: 2, size: 2, total: 3 });
    expect(page2.items.map((row) => row.lotNo)).toEqual([PREFIX + 'C-NEW']);
  });

  it('새 기준 버전이 생기면 검사 행이 없는 LOT은 새 버전, 검사한 LOT은 판정에 쓴 버전을 보여 준다', async () => {
    const v1 = await prisma.inspectionStandard.findUniqueOrThrow({ where: { id: standardV1Id } });
    const v2 = await prisma.inspectionStandard.create({
      data: { inspectionStandardCode: v1.inspectionStandardCode, versionNo: 2, processType: v1.processType, steelGradeId: v1.steelGradeId },
    });
    standardIds.push(v2.id);

    const pendingHeat = (await list()).items.find((row) => row.lotId === lots.heatNew);
    expect(pendingHeat).toMatchObject({ inspectionStandardId: v2.id, versionNo: 2 });
    const passedHeat = (await list({ status: 'done' })).items.find((row) => row.lotId === lots.heatPass);
    expect(passedHeat).toMatchObject({ inspectionStandardId: v1.id, versionNo: 1 });
  });
});

describe('검사 상세 조회 (API-116, REQ-QC-001·003)', () => {
  const prisma = new PrismaService();
  const service = new QualityService(prisma, new QualityRepository(), recorder);
  const lotIds: number[] = [];
  const resultIds: number[] = [];
  const inspectionIds: Record<string, number> = {};
  let inspectorName: string;

  beforeAll(async () => {
    const coilItem9 = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'CL-SM355A-9x1400x227500' } });
    const coilItem45 = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'CL-SM355A-4.5x1500x544000' } });
    const grade = await prisma.steelGrade.findUniqueOrThrow({ where: { steelGradeCode: 'SM355A' } });
    const inspector = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2205013' } });
    inspectorName = inspector.employeeName;
    const standard = (code: string) =>
      prisma.inspectionStandard.findUniqueOrThrow({
        where: { inspectionStandardCode_versionNo: { inspectionStandardCode: code, versionNo: 1 } },
        select: { id: true, inspectionStandardItems: { select: { id: true, inspectionItemCode: true, thicknessOverMm: true } } },
      });
    const hr = await standard('QS-SM355A-HR');
    const st = await standard('QS-SM355A-ST');
    const itemId = (code: string, over?: string) =>
      hr.inspectionStandardItems.find((i) => i.inspectionItemCode === code && (over === undefined || i.thicknessOverMm?.toString() === over))!.id;

    const result = async (processType: string) => {
      const created = await prisma.productionResult.create({
        data: { processType, converterCode: processType === 'STEELMAKING' ? 'BOF1' : null, startedAt: new Date() },
      });
      resultIds.push(created.id);
      return created.id;
    };
    const heat = await prisma.lot.create({
      data: { lotNo: 'QD-H', lotType: 'HEAT', steelGradeId: grade.id, productionResultId: await result('STEELMAKING') },
    });
    const rolling = await result('HOT_ROLLING');
    const coil = (lotNo: string, itemIdValue: number) =>
      prisma.lot.create({
        data: { lotNo, lotType: 'COIL', itemId: itemIdValue, productionResultId: rolling, producedDate: new Date('2026-10-02') },
      });
    const coil9 = await coil('QD-C9', coilItem9.id);
    const coil45 = await coil('QD-C45', coilItem45.id);
    lotIds.push(heat.id, coil9.id, coil45.id);

    const inspect = (lotId: number, inspectionStandardId: number, inspectionResult: string) =>
      prisma.qualityInspection.create({
        data: { lotId, inspectionStandardId, inspectionResult, inspectorEmployeeId: inspector.id, inspectedAt: new Date('2026-10-02T05:00:00Z') },
      });
    const heatInspection = await inspect(heat.id, st.id, 'PASS');
    const coil9Inspection = await inspect(coil9.id, hr.id, 'FAIL');
    const coil45Inspection = await inspect(coil45.id, hr.id, 'PENDING');
    inspectionIds.heat = heatInspection.id;
    inspectionIds.coil9 = coil9Inspection.id;
    inspectionIds.coil45 = coil45Inspection.id;

    // 9mm 코일: 인장강도 경계값(490) 합격, 샤르피 26 불합격, 나머지는 미입력
    await prisma.qualityInspectionValue.createMany({
      data: [
        { qualityInspectionId: coil9Inspection.id, inspectionStandardItemId: itemId('TENSILE_STRENGTH'), measuredValue: '490' },
        { qualityInspectionId: coil9Inspection.id, inspectionStandardItemId: itemId('CHARPY'), measuredValue: '26' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.qualityInspectionValue.deleteMany({ where: { qualityInspectionId: { in: Object.values(inspectionIds) } } });
    await prisma.qualityInspection.deleteMany({ where: { lotId: { in: lotIds } } });
    await prisma.lot.deleteMany({ where: { id: { in: lotIds } } });
    await prisma.productionResult.deleteMany({ where: { id: { in: resultIds } } });
    await prisma.$disconnect();
  });

  it('검사 1건과 판정에 쓴 기준 버전, 검사자를 준다', async () => {
    const detail = await service.getQualityInspection(inspectionIds.coil9);
    expect(detail).toMatchObject({
      qualityInspectionId: inspectionIds.coil9,
      lotNo: 'QD-C9',
      lotType: 'COIL',
      processType: 'HOT_ROLLING',
      steelGradeCode: 'SM355A',
      thicknessMm: '9.00',
      inspectionStandardCode: 'QS-SM355A-HR',
      versionNo: 1,
      inspectionResult: 'FAIL',
      inspectorEmployeeName: inspectorName,
      inspectedAt: '2026-10-02T05:00:00.000Z',
    });
  });

  it('9mm 코일은 두께에 맞는 항목만 (샤르피 포함 7개), 등록 순서대로', async () => {
    const { items } = await service.getQualityInspection(inspectionIds.coil9);
    expect(items.map((i) => [i.inspectionItemCode, i.thicknessOverMm, i.thicknessUptoMm])).toEqual([
      ['YIELD_STRENGTH', null, '16.00'],
      ['TENSILE_STRENGTH', null, null],
      ['ELONGATION', '5.00', '16.00'],
      ['CHARPY', '6.00', null],
      ['THICKNESS_TOL', '8.00', '10.00'],
      ['WIDTH_TOL', null, null],
      ['CAMBER', null, null],
    ]);
  });

  it('항목마다 측정값과 판정: 경계값 합격, 기준 미달 불합격, 값 없음은 null', async () => {
    const { items } = await service.getQualityInspection(inspectionIds.coil9);
    const byCode = (code: string) => items.find((i) => i.inspectionItemCode === code);
    expect(byCode('TENSILE_STRENGTH')).toMatchObject({ minValue: '490.0000', maxValue: '630.0000', measuredValue: '490.0000', isPassed: true });
    expect(byCode('CHARPY')).toMatchObject({ unit: 'J', minValue: '27.0000', measuredValue: '26.0000', isPassed: false, isRequired: true });
    expect(byCode('CAMBER')).toMatchObject({ minValue: null, measuredValue: null, isPassed: null });
  });

  it('4.5mm 코일에는 샤르피가 적용되지 않는다 (REQ-QC-002)', async () => {
    const { items } = await service.getQualityInspection(inspectionIds.coil45);
    expect(items.map((i) => i.inspectionItemCode)).not.toContain('CHARPY');
    expect(items).toHaveLength(6);
  });

  it('히트는 두께가 없어 구간 없는 성분 항목만, 상위 히트는 없다', async () => {
    const detail = await service.getQualityInspection(inspectionIds.heat);
    expect(detail).toMatchObject({ processType: 'STEELMAKING', thicknessMm: null, heatLotId: null, inspectionStandardCode: 'QS-SM355A-ST' });
    expect(detail.items.map((i) => i.inspectionItemCode)).toEqual(['C', 'SI', 'MN', 'P', 'S', 'CEQ']);
  });

  it('없는 검사 id는 COM-003', async () => {
    await expect(service.getQualityInspection(2_000_000_000)).rejects.toMatchObject({ code: 'COM-003' });
  });
});

describe('검사 등록·자동 판정 (API-117·224, REQ-QC-001·003)', () => {
  const prisma = new PrismaService();
  const service = new QualityService(prisma, new QualityRepository(), recorder);
  const lotIds: number[] = [];
  const resultIds: number[] = [];
  let tempSteelGradeId: number;
  let user: AuthUser;
  let lots: Record<string, number>;
  /** QS-SM355A-HR v1의 항목 id. over = 두께 하한('none'은 하한 없음) */
  let hr: (code: string, over?: string) => number;
  let st: (code: string) => number;

  /** 9mm 코일의 적용 항목 7개를 모두 기준 안의 값으로 (경계값 포함) */
  const passValues9mm = () => [
    { inspectionStandardItemId: hr('YIELD_STRENGTH', 'none'), measuredValue: '360' },
    { inspectionStandardItemId: hr('TENSILE_STRENGTH'), measuredValue: '630' },
    { inspectionStandardItemId: hr('ELONGATION', '5'), measuredValue: '17' },
    { inspectionStandardItemId: hr('CHARPY'), measuredValue: '27' },
    { inspectionStandardItemId: hr('THICKNESS_TOL', '8'), measuredValue: '-0.42' },
    { inspectionStandardItemId: hr('WIDTH_TOL'), measuredValue: '0' },
    { inspectionStandardItemId: hr('CAMBER'), measuredValue: '5' },
  ];

  beforeAll(async () => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2205013' } });
    user = {
      employeeId: employee.id,
      employeeNo: employee.employeeNo,
      employeeName: employee.employeeName,
      roleCode: 'QUALITY',
      departmentId: employee.departmentId,
      jobGradeId: employee.jobGradeId,
      headDepartmentIds: [],
      permissions: { INSPECTION_REGISTER: 'USE' },
    };
    const standardItems = async (code: string) =>
      (
        await prisma.inspectionStandard.findUniqueOrThrow({
          where: { inspectionStandardCode_versionNo: { inspectionStandardCode: code, versionNo: 1 } },
          select: { inspectionStandardItems: { select: { id: true, inspectionItemCode: true, thicknessOverMm: true } } },
        })
      ).inspectionStandardItems;
    const hrItems = await standardItems('QS-SM355A-HR');
    const stItems = await standardItems('QS-SM355A-ST');
    hr = (code, over) =>
      hrItems.find(
        (i) =>
          i.inspectionItemCode === code &&
          (over === undefined || (over === 'none' ? i.thicknessOverMm === null : i.thicknessOverMm?.toString() === over)),
      )!.id;
    st = (code) => stItems.find((i) => i.inspectionItemCode === code)!.id;

    const grade = await prisma.steelGrade.findUniqueOrThrow({ where: { steelGradeCode: 'SM355A' } });
    const tempGrade = await prisma.steelGrade.create({
      data: { steelGradeCode: 'QR-NOSTD', steelGradeName: '기준 없는 강종(테스트)', standardNo: 'TEST' },
    });
    tempSteelGradeId = tempGrade.id;
    const coilItem9 = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'CL-SM355A-9x1400x227500' } });
    const coilItem45 = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'CL-SM355A-4.5x1500x544000' } });

    const result = async (processType: string) => {
      const created = await prisma.productionResult.create({
        data: {
          processType,
          converterCode: processType === 'STEELMAKING' ? 'BOF1' : null,
          blastFurnaceCode: processType === 'IRONMAKING' ? 'BF1' : null,
          startedAt: new Date(),
        },
      });
      resultIds.push(created.id);
      return created.id;
    };
    const steelmaking = await result('STEELMAKING');
    const rolling = await result('HOT_ROLLING');
    const ironmaking = await result('IRONMAKING');
    const coil = (lotNo: string, itemId: number) =>
      prisma.lot.create({ data: { lotNo, lotType: 'COIL', itemId, productionResultId: rolling, producedDate: new Date('2026-10-02') } });
    const created = {
      coilPass: await coil('QR-C-PASS', coilItem9.id),
      coilPending: await coil('QR-C-PENDING', coilItem9.id),
      coilFail: await coil('QR-C-FAIL', coilItem9.id),
      coilThin: await coil('QR-C-THIN', coilItem45.id),
      heat: await prisma.lot.create({ data: { lotNo: 'QR-H', lotType: 'HEAT', steelGradeId: grade.id, productionResultId: steelmaking } }),
      heatNoStandard: await prisma.lot.create({
        data: { lotNo: 'QR-H-NOSTD', lotType: 'HEAT', steelGradeId: tempGrade.id, productionResultId: steelmaking },
      }),
      hotMetal: await prisma.lot.create({
        data: { lotNo: 'QR-HM', lotType: 'HOT_METAL', productionResultId: ironmaking, remainingTon: '100' },
      }),
    };
    lots = Object.fromEntries(Object.entries(created).map(([key, lot]) => [key, lot.id]));
    lotIds.push(...Object.values(lots));
  });

  afterAll(async () => {
    const inspections = await prisma.qualityInspection.findMany({ where: { lotId: { in: lotIds } }, select: { id: true } });
    const inspectionIds = inspections.map((i) => i.id);
    await prisma.businessEventLot.deleteMany({ where: { lotId: { in: lotIds } } });
    await prisma.businessEvent.deleteMany({ where: { targetType: 'quality_inspection', targetId: { in: inspectionIds } } });
    await prisma.qualityInspectionValue.deleteMany({ where: { qualityInspectionId: { in: inspectionIds } } });
    await prisma.qualityInspection.deleteMany({ where: { id: { in: inspectionIds } } });
    await prisma.lot.deleteMany({ where: { id: { in: lotIds } } });
    await prisma.productionResult.deleteMany({ where: { id: { in: resultIds } } });
    await prisma.steelGrade.delete({ where: { id: tempSteelGradeId } });
    await prisma.$disconnect();
  });

  it('적용 항목이 모두 기준 안이면 PASS, 최신 기준 버전·검사자를 남기고 상세를 돌려준다', async () => {
    const detail = await service.registerQualityInspection({ lotId: lots.coilPass, values: passValues9mm() }, user);
    expect(detail).toMatchObject({
      lotId: lots.coilPass,
      inspectionResult: 'PASS',
      inspectionStandardCode: 'QS-SM355A-HR',
      versionNo: 1,
      inspectorEmployeeId: user.employeeId,
    });
    expect(detail.items.every((i) => i.isPassed === true)).toBe(true);
    expect(await prisma.qualityInspectionValue.count({ where: { qualityInspectionId: detail.qualityInspectionId } })).toBe(7);
  });

  it('작업 로그 INSPECTION_REGISTERED를 남기고 LOT 타임라인에 연결한다 (REQ-LOG-002)', async () => {
    const inspection = await prisma.qualityInspection.findUniqueOrThrow({ where: { lotId: lots.coilPass } });
    const event = await prisma.businessEvent.findFirstOrThrow({
      where: { targetType: 'quality_inspection', targetId: inspection.id },
      include: { businessEventLots: true },
    });
    expect(event).toMatchObject({
      businessEventType: 'INSPECTION_REGISTERED',
      actorType: 'USER',
      actorEmployeeId: user.employeeId,
      salesOrderId: null,
    });
    expect(event.businessEventLots.map((l) => l.lotId)).toEqual([lots.coilPass]);
    expect(event.afterData).toMatchObject({ inspectionResult: 'PASS', inspectionStandardCode: 'QS-SM355A-HR', versionNo: 1 });
  });

  it('필수 항목 값이 비면 PENDING, 빠진 항목을 작업 로그에 남긴다', async () => {
    const values = passValues9mm().filter((v) => v.inspectionStandardItemId !== hr('CHARPY'));
    const detail = await service.registerQualityInspection({ lotId: lots.coilPending, values }, user);
    expect(detail.inspectionResult).toBe('PENDING');
    expect(detail.items.find((i) => i.inspectionItemCode === 'CHARPY')).toMatchObject({ measuredValue: null, isPassed: null });
    const event = await prisma.businessEvent.findFirstOrThrow({
      where: { targetType: 'quality_inspection', targetId: detail.qualityInspectionId },
    });
    expect(event.afterData).toMatchObject({ missingRequiredItemCodes: ['CHARPY'], failedItemCodes: [] });
  });

  it('벗어난 값이 있으면 필수 항목이 비어 있어도 FAIL', async () => {
    const detail = await service.registerQualityInspection(
      { lotId: lots.coilFail, values: [{ inspectionStandardItemId: hr('CHARPY'), measuredValue: '26.9999' }] },
      user,
    );
    expect(detail.inspectionResult).toBe('FAIL');
  });

  it('히트는 성분 기준(제강)으로 판정한다', async () => {
    // 시드 SM355A 성분 상한: C 0.20, SI 0.55, MN 1.60, P·S 0.035, CEQ 0.47
    const composition: [string, string][] = [['C', '0.18'], ['SI', '0.4'], ['MN', '1.5'], ['P', '0.03'], ['S', '0.035'], ['CEQ', '0.45']];
    const values = composition.map(([code, measuredValue]) => ({ inspectionStandardItemId: st(code), measuredValue }));
    const detail = await service.registerQualityInspection({ lotId: lots.heat, values }, user);
    expect(detail).toMatchObject({ processType: 'STEELMAKING', inspectionStandardCode: 'QS-SM355A-ST', inspectionResult: 'PASS' });
  });

  it('이미 검사가 있는 LOT은 COM-001 (LOT당 1건)', async () => {
    await expect(service.registerQualityInspection({ lotId: lots.coilPass, values: [] }, user)).rejects.toMatchObject({
      code: 'COM-001',
    });
  });

  it('LOT 두께에 적용되지 않는 항목·같은 항목 두 번은 COM-004, 아무것도 저장하지 않는다', async () => {
    const charpy = { inspectionStandardItemId: hr('CHARPY'), measuredValue: '30' };
    await expect(service.registerQualityInspection({ lotId: lots.coilThin, values: [charpy] }, user)).rejects.toMatchObject({
      code: 'COM-004',
    });
    const camber = { inspectionStandardItemId: hr('CAMBER'), measuredValue: '1' };
    await expect(service.registerQualityInspection({ lotId: lots.coilThin, values: [camber, camber] }, user)).rejects.toMatchObject({
      code: 'COM-004',
    });
    expect(await prisma.qualityInspection.count({ where: { lotId: lots.coilThin } })).toBe(0);
  });

  it('검사 대상이 아닌 LOT(용선)은 COM-004, 없는 LOT은 COM-003', async () => {
    await expect(service.registerQualityInspection({ lotId: lots.hotMetal, values: [] }, user)).rejects.toMatchObject({ code: 'COM-004' });
    await expect(service.registerQualityInspection({ lotId: 2_000_000_000, values: [] }, user)).rejects.toMatchObject({ code: 'COM-003' });
  });

  it('그 공정·강종의 검사 기준이 없으면 MST-001', async () => {
    await expect(service.registerQualityInspection({ lotId: lots.heatNoStandard, values: [] }, user)).rejects.toMatchObject({
      code: 'MST-001',
    });
  });
});
