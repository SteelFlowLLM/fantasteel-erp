// 과거 사례 서비스: 등록 사례는 실제 DB(fs_collab)에 저장하고, 초안용 LOT 검사 조회는 고정 값, AI는 가짜 응답으로 확인한다.
import { LOT_TYPE, PROCESS_TYPE, ROLE, formatCaseNo, type AuthUser } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { LlmClient } from '../llm/llm.client';
import type { LlmSettingsStore } from '../llm/llm-settings.store';
import { PastCaseRepository } from './past-case.repository';
import { PastCaseService } from './past-case.service';

type DraftLot = NonNullable<Awaited<ReturnType<PastCaseRepository['findLot']>>>;

const prisma = new PrismaService();
const repository = new PastCaseRepository();
const decimal = (v: string) => new Prisma.Decimal(v);

// 초안 대상 LOT (검사 조회만 고정 값으로 바꾼다)
const failedHeat: DraftLot = {
  id: 101,
  lotNo: 'HT-BOF1-261014-001',
  lotType: 'HEAT',
  dispositionStatus: 'HOLD',
  dispositionReason: null,
  steelGrade: { steelGradeCode: 'SM355A' },
  item: null,
  qualityInspection: {
    inspectionResult: 'FAIL',
    inspectedAt: new Date('2026-10-14T01:00:00Z'),
    inspectionStandard: { processType: 'STEELMAKING' },
    qualityInspectionValues: [
      { measuredValue: decimal('1.68'), inspectionStandardItem: { inspectionItemCode: 'MN', inspectionItemName: '망가니즈', unit: '%', minValue: null, maxValue: decimal('1.6') } },
      { measuredValue: decimal('0.18'), inspectionStandardItem: { inspectionItemCode: 'C', inspectionItemName: '탄소', unit: '%', minValue: null, maxValue: decimal('0.2') } },
    ],
  },
};
const slab: DraftLot = { ...failedHeat, id: 102, lotNo: 'HT-BOF1-261014-001-03', lotType: 'SLAB', steelGrade: null, item: { itemCode: 'SL-SM355A-250x1500x10000', steelGrade: { steelGradeCode: 'SM355A' } }, qualityInspection: null };
const passed: DraftLot = { ...slab, id: 103, lotNo: 'HT-BOF1-261014-002-01', qualityInspection: { ...failedHeat.qualityInspection!, inspectionResult: 'PASS' } };
const draftLots = new Map<number, DraftLot>([
  [101, failedHeat],
  [102, slab],
  [103, passed],
]);

let user: AuthUser;
let resultId: number;
const heatIds: number[] = [];
const createdCaseIds: number[] = [];
let model: string | null;
let llmReply: () => Promise<unknown>;
const service = () =>
  new PastCaseService(
    prisma,
    repository,
    { read: async () => ({ baseUrl: 'http://127.0.0.1:1234/v1', model, apiKey: null }) } as unknown as LlmSettingsStore,
    { chatJson: () => llmReply() } as unknown as LlmClient,
  );
const register = async (input: Parameters<PastCaseService['create']>[1]) => {
  const created = await service().create(user, input);
  createdCaseIds.push(created.id);
  return created;
};

beforeAll(async () => {
  const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2205013' } });
  user = { employeeId: employee.id, employeeNo: employee.employeeNo, employeeName: employee.employeeName, roleCode: ROLE.QUALITY, departmentId: employee.departmentId, jobGradeId: employee.jobGradeId, headDepartmentIds: [], permissions: {} };
  // 등록 사례의 관련 LOT은 실제 LOT이어야 해서 히트 2개를 만든다
  const grade = await prisma.steelGrade.findUniqueOrThrow({ where: { steelGradeCode: 'SM355A' } });
  resultId = (await prisma.productionResult.create({ data: { processType: PROCESS_TYPE.STEELMAKING, converterCode: 'BOF9', startedAt: new Date('2026-10-14T00:00:00Z'), completedAt: new Date('2026-10-14T01:00:00Z') } })).id;
  for (const lotNo of ['HT-BOF9-261014-001', 'HT-BOF9-261014-002']) {
    heatIds.push((await prisma.lot.create({ data: { lotNo, lotType: LOT_TYPE.HEAT, steelGradeId: grade.id, productionResultId: resultId, initialTon: '250.000' } })).id);
  }
  const findLot = async (_tx: unknown, id: number) => draftLots.get(id) ?? null;
  const findParentLots = async (_tx: unknown, id: number) => (id === 102 ? [{ parentLot: failedHeat }] : []);
  jest.spyOn(repository, 'findLot').mockImplementation(findLot as unknown as PastCaseRepository['findLot']);
  jest.spyOn(repository, 'findParentLots').mockImplementation(findParentLots as unknown as PastCaseRepository['findParentLots']);
}, 60_000);

afterAll(async () => {
  await prisma.pastCaseLot.deleteMany({ where: { pastCaseId: { in: createdCaseIds } } });
  await prisma.pastCase.deleteMany({ where: { id: { in: createdCaseIds } } });
  await prisma.lot.deleteMany({ where: { id: { in: heatIds } } });
  if (resultId) await prisma.productionResult.delete({ where: { id: resultId } });
  await prisma.$disconnect();
});

beforeEach(() => {
  model = 'qwen';
  llmReply = async () => ({ caseCategory: 'QUALITY', title: 'SM355A 히트 망가니즈 초과', phenomenon: '망가니즈 1.68%로 기준 초과예요.', cause: '확인 필요', actionTaken: '확인 필요', equipmentText: '' });
});

describe('사례 초안 (API-269)', () => {
  it('AI 초안: 검사일을 발생일로, 비슷한 사례 번호를 함께 준다', async () => {
    const draft = await service().createDraft(101);
    expect(draft).toMatchObject({ aiWritten: true, aiNotice: null, title: 'SM355A 히트 망가니즈 초과', occurredDate: '2026-10-14', lot: { lotId: 101, steelGradeCode: 'SM355A' } });
    expect(draft.referenceCaseNos[0]).toBe('CASE-0005');
  });

  it('AI가 실패해도 오류 없이 검사 결과 초안과 이유를 준다 (모델 미설정·연결 실패·이상한 답)', async () => {
    model = null;
    expect(await service().createDraft(101)).toMatchObject({ aiWritten: false, aiNotice: expect.stringContaining('AI 모델이 아직 정해지지 않았어요') });
    model = 'qwen';
    llmReply = async () => {
      throw new Error('timeout');
    };
    const failed = await service().createDraft(101);
    expect(failed).toMatchObject({ aiWritten: false, aiNotice: expect.stringContaining('연결하지 못했거나') });
    expect(failed.phenomenon).toContain('망가니즈(MN) 1.68 %');
    expect(failed.phenomenon).not.toContain('탄소');
    llmReply = async () => 'not json';
    expect(await service().createDraft(101)).toMatchObject({ aiWritten: false, aiNotice: expect.stringContaining('형식이 맞지 않았어요') });
  });

  it('상위 히트 성분 불합격 슬래브도 초안을 쓰고, 합격 LOT·없는 LOT은 막는다', async () => {
    model = null;
    expect((await service().createDraft(102)).phenomenon).toContain('상위 히트 HT-BOF1-261014-001');
    await expect(service().createDraft(103)).rejects.toMatchObject({ code: 'COM-004' });
    await expect(service().createDraft(999)).rejects.toBeInstanceOf(AppException);
  });
});

describe('사례 등록·검색·상세 (API-267·268·270, DB past_case)', () => {
  const input = () => ({ caseCategory: 'QUALITY' as const, title: 'SM355A 히트 망가니즈 초과', phenomenon: '현상', cause: '', actionTaken: '', equipmentText: '', occurredDate: '2026-10-14', lotIds: [heatIds[0]!, heatIds[0]!, heatIds[1]!] });

  it('등록하면 예시 사례 다음(id 6 이상) CASE-{id}로 번호를 매겨 DB에 남기고, 검색·상세에 함께 나온다', async () => {
    const first = await register(input());
    const second = await register(input());
    // 테스트 DB는 실행마다 새로 만들어 첫 번호가 CASE-0006이다. 같은 DB로 다시 돌려도 깨지지 않게 id에서 번호를 본다
    expect(first.id).toBeGreaterThanOrEqual(6);
    expect(second.id).toBe(first.id + 1);
    expect(first).toMatchObject({
      caseNo: formatCaseNo(first.id),
      isExample: false,
      createdEmployeeName: '서민지',
      cause: '',
      occurredDate: '2026-10-14',
      lots: [
        { lotId: heatIds[0], lotNo: 'HT-BOF9-261014-001' },
        { lotId: heatIds[1], lotNo: 'HT-BOF9-261014-002' },
      ],
    });
    expect(second.caseNo).toBe(formatCaseNo(second.id));
    const saved = await prisma.pastCase.findUniqueOrThrow({ where: { id: first.id }, include: { pastCaseLots: true } });
    expect(saved).toMatchObject({ createdEmployeeId: user.employeeId, cause: null, actionTaken: null, equipmentText: null });
    expect(saved.pastCaseLots.map((l) => l.lotId)).toEqual(heatIds);
    expect((await service().search({ q: '망가니즈 초과' }))[0]?.caseNo).toBe(second.caseNo);
    expect((await service().detail(first.id)).caseNo).toBe(first.caseNo);
    await expect(service().detail(99_999)).rejects.toMatchObject({ code: 'COM-003' });
  });

  it('동시에 등록해도 번호가 겹치지 않고 임시 번호가 남지 않는다', async () => {
    const created = await Promise.all([register(input()), register(input()), register(input())]);
    expect(new Set(created.map((c) => c.id)).size).toBe(3);
    for (const c of created) expect(c.caseNo).toBe(formatCaseNo(c.id));
    expect(await prisma.pastCase.count({ where: { caseNo: { startsWith: 'PENDING-' } } })).toBe(0);
  });

  it('없는 LOT·오늘 뒤 발생일은 등록하지 않는다', async () => {
    const count = await prisma.pastCase.count();
    await expect(service().create(user, { ...input(), lotIds: [999_999] })).rejects.toMatchObject({ code: 'COM-003' });
    await expect(service().create(user, { ...input(), occurredDate: '2999-01-01' })).rejects.toMatchObject({ code: 'COM-004' });
    expect(await prisma.pastCase.count()).toBe(count);
  });
});
