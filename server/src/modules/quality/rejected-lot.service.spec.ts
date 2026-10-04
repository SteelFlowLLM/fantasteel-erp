import type { AuthUser, Permission } from '@fantasteel/shared';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { NumberingRepository } from '../../common/numbering/numbering.repository';
import { NumberingService } from '../../common/numbering/numbering.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RejectedLotRepository } from './rejected-lot.repository';
import { RejectedLotService } from './rejected-lot.service';

const recorder = new BusinessEventRecorder(new NumberingService(new NumberingRepository()));

// 실제 DB(npm test의 fs_prod)를 쓴다. 이 파일의 LOT 번호는 모두 PREFIX로 시작하고, 목록에서 PREFIX 행만 본다.
const PREFIX = 'QJ-';

describe('불합격 LOT 목록 조회 (API-123, REQ-QC-004)', () => {
  const prisma = new PrismaService();
  const service = new RejectedLotService(prisma, new RejectedLotRepository(), recorder);
  const lotIds: number[] = [];
  const resultIds: number[] = [];
  let lots: Record<string, number>;
  let inspectorId: number;

  const userWith = (permissions: Partial<Record<Permission, 'VIEW' | 'USE'>>): AuthUser => ({
    employeeId: inspectorId,
    employeeNo: 'test',
    employeeName: 'test',
    roleCode: 'QUALITY',
    departmentId: 1,
    jobGradeId: 1,
    headDepartmentIds: [],
    permissions,
  });
  const qualityUser = () => userWith({ INSPECTION_REGISTER: 'USE', DISPOSITION_SET: 'USE' });
  const myRows = async (user = qualityUser()) =>
    (await service.listRejectedLots({ size: 100 }, user)).items.filter((row) => row.lotNo.startsWith(PREFIX));

  beforeAll(async () => {
    const grade = await prisma.steelGrade.findUniqueOrThrow({ where: { steelGradeCode: 'SM355A' } });
    const slabItem = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SM355A-250x1500x10000' } });
    const coilItem = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'CL-SM355A-9x1400x227500' } });
    inspectorId = (await prisma.employee.findFirstOrThrow({ select: { id: true } })).id;
    const standard = (code: string) =>
      prisma.inspectionStandard.findUniqueOrThrow({
        where: { inspectionStandardCode_versionNo: { inspectionStandardCode: code, versionNo: 1 } },
      });
    const st = await standard('QS-SM355A-ST');
    const cc = await standard('QS-SM355A-CC');
    const hr = await standard('QS-SM355A-HR');

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

    const heat = (lotNo: string) =>
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
      await prisma.lotRelation.create({ data: { parentLotId, childLotId: lot.id, lotRelationEvidence: 'ACTUAL_INPUT' } });
      return lot;
    };
    const inspect = (lotId: number, inspectionStandardId: number, inspectionResult: string) =>
      prisma.qualityInspection.create({
        data: { lotId, inspectionStandardId, inspectionResult, inspectorEmployeeId: inspectorId, inspectedAt: new Date() },
      });

    // 불합격 히트와 그 하위 슬래브·코일 (하위는 검사 전)
    const heatFail = await heat('H-FAIL');
    const slabUnderFailHeat = await product('S-UNDER-FAIL-H', 'SLAB', heatFail.id);
    const coilUnderFailHeat = await product('C-UNDER-FAIL-H', 'COIL', slabUnderFailHeat.id);
    // 합격 히트: 슬래브 불합격, 그 하위 코일 합격, 다른 코일 불합격
    const heatPass = await heat('H-PASS');
    const slabFail = await product('S-FAIL', 'SLAB', heatPass.id);
    const coilUnderFailSlab = await product('C-UNDER-FAIL-S', 'COIL', slabFail.id);
    const slabPass = await product('S-PASS', 'SLAB', heatPass.id);
    const coilFail = await product('C-FAIL', 'COIL', slabPass.id);

    await inspect(heatFail.id, st.id, 'FAIL');
    await inspect(heatPass.id, st.id, 'PASS');
    await inspect(slabFail.id, cc.id, 'FAIL');
    await inspect(slabPass.id, cc.id, 'PASS');
    await inspect(coilUnderFailSlab.id, hr.id, 'PASS');
    await inspect(coilFail.id, hr.id, 'FAIL');
    await prisma.lot.update({ where: { id: coilFail.id }, data: { dispositionStatus: 'HOLD', dispositionReason: '샤르피 미달, 재시험 대기' } });

    lots = {
      heatFail: heatFail.id,
      slabUnderFailHeat: slabUnderFailHeat.id,
      coilUnderFailHeat: coilUnderFailHeat.id,
      heatPass: heatPass.id,
      slabFail: slabFail.id,
      coilUnderFailSlab: coilUnderFailSlab.id,
      slabPass: slabPass.id,
      coilFail: coilFail.id,
    };
    lotIds.push(...Object.values(lots));
  });

  afterAll(async () => {
    await prisma.qualityInspection.deleteMany({ where: { lotId: { in: lotIds } } });
    await prisma.lotRelation.deleteMany({ where: { childLotId: { in: lotIds } } });
    await prisma.lot.deleteMany({ where: { id: { in: lotIds } } });
    await prisma.productionResult.deleteMany({ where: { id: { in: resultIds } } });
    await prisma.$disconnect();
  });

  it('자기 검사 FAIL인 LOT과 불합격 히트의 하위 슬래브·코일만, 최근 LOT부터 (TRM-078)', async () => {
    expect((await myRows()).map((row) => row.lotNo)).toEqual([
      PREFIX + 'C-FAIL',
      PREFIX + 'S-FAIL',
      PREFIX + 'C-UNDER-FAIL-H',
      PREFIX + 'S-UNDER-FAIL-H',
      PREFIX + 'H-FAIL',
    ]);
  });

  it('불합격 슬래브의 하위 코일은 상위 히트가 합격이고 자기 검사가 합격이면 넣지 않는다 (적격 = 자기 PASS + 히트 PASS, [ERD])', async () => {
    expect((await myRows()).map((row) => row.lotId)).not.toContain(lots.coilUnderFailSlab);
  });

  it('행에 자기 판정·상위 히트 판정으로 불합격 이유를 알 수 있다', async () => {
    const rows = await myRows();
    expect(rows.find((row) => row.lotId === lots.coilUnderFailHeat)).toMatchObject({
      lotType: 'COIL',
      processType: 'HOT_ROLLING',
      steelGradeCode: 'SM355A',
      thicknessMm: '9.00',
      qualityInspectionId: null,
      inspectionResult: null,
      heatLotId: lots.heatFail,
      heatInspectionResult: 'FAIL',
    });
    expect(rows.find((row) => row.lotId === lots.slabFail)).toMatchObject({ inspectionResult: 'FAIL', heatInspectionResult: 'PASS' });
    expect(rows.find((row) => row.lotId === lots.heatFail)).toMatchObject({ lotType: 'HEAT', inspectionResult: 'FAIL', heatLotId: null });
  });

  it('처리 상태·사유를 주고, 지정 전이면 null(미지정)', async () => {
    const rows = await myRows();
    expect(rows.find((row) => row.lotId === lots.coilFail)).toMatchObject({
      dispositionStatus: 'HOLD',
      dispositionReason: '샤르피 미달, 재시험 대기',
    });
    expect(rows.find((row) => row.lotId === lots.slabFail)).toMatchObject({ dispositionStatus: null, dispositionReason: null });
  });

  it('page·size로 나누고 total은 전체 불합격 LOT 수', async () => {
    const first = await service.listRejectedLots({ page: 1, size: 2 }, qualityUser());
    expect(first).toMatchObject({ page: 1, size: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.total).toBeGreaterThanOrEqual(5);
  });

  it('DISPOSITION_SET 또는 INSPECTION_REGISTER VIEW 중 하나만 있어도 볼 수 있고, 둘 다 없으면 COM-002', async () => {
    expect(await myRows(userWith({ DISPOSITION_SET: 'VIEW' }))).toHaveLength(5);
    expect(await myRows(userWith({ INSPECTION_REGISTER: 'VIEW' }))).toHaveLength(5);
    await expect(service.listRejectedLots({}, userWith({ SALES_ORDER_CREATE: 'USE' }))).rejects.toMatchObject({ code: 'COM-002' });
  });
});

describe('불합격 처리 상태 지정 (API-226·124, REQ-QC-004)', () => {
  const prisma = new PrismaService();
  const service = new RejectedLotService(prisma, new RejectedLotRepository(), recorder);
  const lotIds: number[] = [];
  const resultIds: number[] = [];
  let lots: Record<string, number>;
  let user: AuthUser;

  const updatedAtOf = async (lotId: number) => (await prisma.lot.findUniqueOrThrow({ where: { id: lotId } })).updatedAt.toISOString();
  const set = async (lotId: number, dispositionStatus: 'HOLD' | 'DOWNGRADED' | 'SCRAPPED', dispositionReason: string, expectedUpdatedAt?: string) =>
    service.setLotDisposition(
      lotId,
      { dispositionStatus, dispositionReason, expectedUpdatedAt: expectedUpdatedAt ?? (await updatedAtOf(lotId)) },
      user,
    );
  const eventsOf = (lotId: number) =>
    prisma.businessEvent.findMany({ where: { targetType: 'lot', targetId: lotId }, orderBy: { id: 'asc' }, include: { businessEventLots: true } });

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
      permissions: { DISPOSITION_SET: 'USE' },
    };
    const grade = await prisma.steelGrade.findUniqueOrThrow({ where: { steelGradeCode: 'SM355A' } });
    const slabItem = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SM355A-250x1500x10000' } });
    const coilItem = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'CL-SM355A-9x1400x227500' } });
    const standard = (code: string) =>
      prisma.inspectionStandard.findUniqueOrThrow({
        where: { inspectionStandardCode_versionNo: { inspectionStandardCode: code, versionNo: 1 } },
      });
    const st = await standard('QS-SM355A-ST');
    const hr = await standard('QS-SM355A-HR');
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
    const inspect = (lotId: number, inspectionStandardId: number, inspectionResult: string) =>
      prisma.qualityInspection.create({
        data: { lotId, inspectionStandardId, inspectionResult, inspectorEmployeeId: employee.id, inspectedAt: new Date() },
      });

    const heatFail = await prisma.lot.create({
      data: { lotNo: 'QK-H-FAIL', lotType: 'HEAT', steelGradeId: grade.id, productionResultId: steelmaking },
    });
    const slabUnderFailHeat = await prisma.lot.create({
      data: { lotNo: 'QK-S-UNDER-FAIL-H', lotType: 'SLAB', itemId: slabItem.id, productionResultId: casting, producedDate },
    });
    await prisma.lotRelation.create({
      data: { parentLotId: heatFail.id, childLotId: slabUnderFailHeat.id, lotRelationEvidence: 'ACTUAL_INPUT' },
    });
    const coil = (lotNo: string) =>
      prisma.lot.create({ data: { lotNo, lotType: 'COIL', itemId: coilItem.id, productionResultId: rolling, producedDate } });
    const coilFail = await coil('QK-C-FAIL');
    const coilConflict = await coil('QK-C-CONFLICT');
    const coilPass = await coil('QK-C-PASS');
    await inspect(heatFail.id, st.id, 'FAIL');
    await inspect(coilFail.id, hr.id, 'FAIL');
    await inspect(coilConflict.id, hr.id, 'FAIL');
    await inspect(coilPass.id, hr.id, 'PASS');

    lots = {
      heatFail: heatFail.id,
      slabUnderFailHeat: slabUnderFailHeat.id,
      coilFail: coilFail.id,
      coilConflict: coilConflict.id,
      coilPass: coilPass.id,
    };
    lotIds.push(...Object.values(lots));
  });

  afterAll(async () => {
    await prisma.businessEventLot.deleteMany({ where: { lotId: { in: lotIds } } });
    await prisma.businessEvent.deleteMany({ where: { targetType: 'lot', targetId: { in: lotIds } } });
    await prisma.qualityInspection.deleteMany({ where: { lotId: { in: lotIds } } });
    await prisma.lotRelation.deleteMany({ where: { childLotId: { in: lotIds } } });
    await prisma.lot.deleteMany({ where: { id: { in: lotIds } } });
    await prisma.productionResult.deleteMany({ where: { id: { in: resultIds } } });
    await prisma.$disconnect();
  });

  it('자기 FAIL LOT에 처리 상태·사유를 기록하고, 응답은 그 LOT의 불합격 목록 행', async () => {
    const before = await updatedAtOf(lots.coilFail);
    const row = await set(lots.coilFail, 'HOLD', '  샤르피 미달, 재시험 대기  ', before);
    expect(row).toMatchObject({ lotId: lots.coilFail, inspectionResult: 'FAIL', dispositionStatus: 'HOLD', dispositionReason: '샤르피 미달, 재시험 대기' });
    expect(row.updatedAt).not.toBe(before);
    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lots.coilFail } });
    expect(lot).toMatchObject({ dispositionStatus: 'HOLD', dispositionReason: '샤르피 미달, 재시험 대기', lotStatus: 'AVAILABLE' });
  });

  it('작업 로그 DISPOSITION_SET: 변경 전·후, 사유, LOT 타임라인 연결 (quality.md 5장)', async () => {
    const [event] = await eventsOf(lots.coilFail);
    expect(event).toMatchObject({
      businessEventType: 'DISPOSITION_SET',
      actorType: 'USER',
      actorEmployeeId: user.employeeId,
      reason: '샤르피 미달, 재시험 대기',
      salesOrderId: null,
    });
    expect(event.beforeData).toEqual({ dispositionStatus: null, dispositionReason: null });
    expect(event.afterData).toEqual({ dispositionStatus: 'HOLD', dispositionReason: '샤르피 미달, 재시험 대기' });
    expect(event.businessEventLots.map((l) => l.lotId)).toEqual([lots.coilFail]);
  });

  it('다시 지정해 바꿀 수 있다 (API-124)', async () => {
    const row = await set(lots.coilFail, 'DOWNGRADED', '재시험도 미달, 격하');
    expect(row).toMatchObject({ dispositionStatus: 'DOWNGRADED', dispositionReason: '재시험도 미달, 격하' });
    const [, second] = await eventsOf(lots.coilFail);
    expect(second.beforeData).toEqual({ dispositionStatus: 'HOLD', dispositionReason: '샤르피 미달, 재시험 대기' });
  });

  it('불합격 히트의 하위 LOT(자기 검사 전)에도 지정할 수 있다 (TRM-078)', async () => {
    const row = await set(lots.slabUnderFailHeat, 'SCRAPPED', '히트 성분 불합격');
    expect(row).toMatchObject({ inspectionResult: null, heatInspectionResult: 'FAIL', dispositionStatus: 'SCRAPPED' });
  });

  it('expectedUpdatedAt이 지금 값과 다르면 COM-001, 아무것도 바꾸지 않는다', async () => {
    const stale = await updatedAtOf(lots.coilConflict);
    await set(lots.coilConflict, 'HOLD', '첫 지정', stale);
    await expect(set(lots.coilConflict, 'SCRAPPED', '늦은 지정', stale)).rejects.toMatchObject({ code: 'COM-001' });
    expect(await prisma.lot.findUniqueOrThrow({ where: { id: lots.coilConflict } })).toMatchObject({
      dispositionStatus: 'HOLD',
      dispositionReason: '첫 지정',
    });
    expect(await eventsOf(lots.coilConflict)).toHaveLength(1);
  });

  it('불합격이 아닌 LOT은 COM-004, 없는 LOT은 COM-003, 공백 사유는 COM-004', async () => {
    await expect(set(lots.coilPass, 'HOLD', '사유')).rejects.toMatchObject({
      code: 'COM-004',
      message: '불합격 LOT에만 처리 상태를 지정할 수 있어요',
    });
    await expect(set(2_000_000_000, 'HOLD', '사유', new Date().toISOString())).rejects.toMatchObject({ code: 'COM-003' });
    await expect(set(lots.coilFail, 'HOLD', '   ')).rejects.toMatchObject({ code: 'COM-004' });
    expect(await prisma.lot.findUniqueOrThrow({ where: { id: lots.coilPass } })).toMatchObject({ dispositionStatus: null });
  });
});
