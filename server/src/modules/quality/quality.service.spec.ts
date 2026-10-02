import { PrismaService } from '../../prisma/prisma.service';
import { QualityRepository } from './quality.repository';
import { QualityService } from './quality.service';

// 실제 DB(npm test의 fs_prod)를 쓴다. 다른 테스트의 LOT과 섞이지 않도록 이 파일의 LOT 번호는 모두 PREFIX로 시작한다.
const PREFIX = 'QT-';

describe('검사 대기·검사 목록 조회 (API-125, REQ-QC-001)', () => {
  const prisma = new PrismaService();
  const service = new QualityService(prisma, new QualityRepository());
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
