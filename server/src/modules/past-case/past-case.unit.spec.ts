import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Prisma } from '../../generated/prisma/client';
import { PAST_CASE_EXAMPLES, ROLE, caseKeywords, searchPastCases, type AuthUser } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LlmClient } from '../llm/llm.client';
import type { LlmSettingsStore } from '../llm/llm-settings.store';
import { buildDraftMessages, failedItemText, parseDraft, ruleDraft, similarQueryOf, type FailureFacts } from './past-case.draft';
import type { PastCaseRepository } from './past-case.repository';
import { PastCaseService } from './past-case.service';
import { PastCaseStore } from './past-case.store';

const QUALITY_USER: AuthUser = { employeeId: 13, employeeNo: '2205013', employeeName: '서민지', roleCode: ROLE.QUALITY, departmentId: 1, jobGradeId: 1, headDepartmentIds: [], permissions: {} };

const facts: FailureFacts = {
  lotNo: 'HT-BOF1-261014-001',
  lotType: 'HEAT',
  steelGradeCode: 'SM355A',
  processType: 'STEELMAKING',
  inspectedDate: '2026-10-14',
  failedItems: [{ name: '망가니즈', code: 'MN', value: '1.68', unit: '%', min: null, max: '1.60' }],
  dispositionStatus: 'HOLD',
  dispositionReason: '성분 재확인',
  viaLotNo: null,
};

describe('과거 사례 검색 규칙 (shared, 서버·화면 공통)', () => {
  it('핵심어: 두 글자 이상, 조사·질문마다 붙는 말 제외, 설비 이름 끝 "로"는 남긴다', () => {
    expect(caseKeywords('SM355A 히트 불합격과 비슷한 과거 사례 찾아줘')).toEqual(['SM355A', '히트', '불합격']);
    expect(caseKeywords('가열로 온도')).toEqual(['가열로', '온도']);
  });

  it('많이 맞는 순, 같으면 최신순. 구분·기간으로 거른다', () => {
    const nos = (q: string, extra: { category?: 'QUALITY' | 'EQUIPMENT'; days?: number } = {}) => searchPastCases(PAST_CASE_EXAMPLES, { q, ...extra }, '2026-10-16').map((c) => c.caseNo);
    expect(nos('')).toEqual(['CASE-0005', 'CASE-0004', 'CASE-0003', 'CASE-0002', 'CASE-0001']);
    expect(nos('SM355A 히트 불합격')[0]).toBe('CASE-0005');
    expect(nos('', { category: 'EQUIPMENT' })).toEqual(['CASE-0003', 'CASE-0001']);
    expect(nos('', { days: 90 })).toEqual(['CASE-0005', 'CASE-0004', 'CASE-0003', 'CASE-0002']);
    expect(nos('없는말')).toEqual([]);
  });
});

describe('사례 초안 (REQ-CASE-002)', () => {
  it('검사 결과 초안: 기준을 벗어난 값과 처리 상태로 채우고 원인은 비운다', () => {
    expect(failedItemText(facts.failedItems[0]!)).toBe('망가니즈(MN) 1.68 % (기준 1.60 이하)');
    expect(failedItemText({ name: '항복강도', code: 'YIELD_STRENGTH', value: '300', unit: 'N/mm²', min: '355', max: null })).toBe('항복강도 300 N/mm² (기준 355 이상)');
    const draft = ruleDraft(facts);
    expect(draft).toMatchObject({ caseCategory: 'QUALITY', cause: '', equipmentText: '' });
    expect(draft.title).toBe('SM355A 히트 제강 검사 불합격');
    expect(draft.phenomenon).toContain('망가니즈(MN) 1.68 %');
    expect(draft.actionTaken).toContain('보류');
    expect(ruleDraft({ ...facts, lotType: 'SLAB', lotNo: 'HT-BOF1-261014-001-03', viaLotNo: 'HT-BOF1-261014-001' }).phenomenon).toContain('상위 히트 HT-BOF1-261014-001');
  });

  it('AI 답은 제목·현상이 있어야 쓰고, 구분은 EQUIPMENT가 아니면 QUALITY, 긴 글은 자른다', () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft({ title: '', phenomenon: 'x' })).toBeNull();
    expect(parseDraft({ caseCategory: 'OTHER', title: ' 제목 ', phenomenon: '현상', cause: 3 })).toEqual({ caseCategory: 'QUALITY', title: '제목', phenomenon: '현상', cause: '', actionTaken: '', equipmentText: '' });
    expect(parseDraft({ caseCategory: 'EQUIPMENT', title: 't'.repeat(300), phenomenon: 'p' })?.title).toHaveLength(200);
  });

  it('AI에 넘기는 글: 불합격 사실의 숫자와 비슷한 사례(예시 표시), 숫자를 지어내지 말라는 규칙', () => {
    const [system, user] = buildDraftMessages(facts, [PAST_CASE_EXAMPLES[0]!]);
    expect(system?.content).toContain('숫자(측정값·기준)는 [불합격 사실]에 있는 값만');
    expect(user?.content).toContain('망가니즈(MN) 1.68 % (기준 1.60 이하)');
    expect(user?.content).toContain('CASE-0005');
    expect(user?.content).toContain('(예시 사례)');
    expect(similarQueryOf(facts)).toBe('SM355A 히트 망가니즈 불합격');
  });
});

describe('PastCaseStore / PastCaseService (DB 없이 저장소 파일)', () => {
  let dir: string;
  const before = process.env.STORAGE_DIR;
  const decimal = (v: string) => new Prisma.Decimal(v);
  const failedHeat = {
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
  const slab = { ...failedHeat, id: 102, lotNo: 'HT-BOF1-261014-001-03', lotType: 'SLAB', steelGrade: null, item: { itemCode: 'SL-SM355A-250x1500x10000', steelGrade: { steelGradeCode: 'SM355A' } }, qualityInspection: null };
  const passed = { ...slab, id: 103, lotNo: 'HT-BOF1-261014-002-01', qualityInspection: { ...failedHeat.qualityInspection, inspectionResult: 'PASS' } };
  const lots = new Map<number, unknown>([
    [101, failedHeat],
    [102, slab],
    [103, passed],
  ]);
  const repository = {
    findLot: async (_tx: unknown, id: number) => lots.get(id) ?? null,
    findParentLots: async (_tx: unknown, id: number) => (id === 102 ? [{ parentLot: failedHeat }] : []),
    findLotNos: async (_tx: unknown, ids: number[]) => ids.filter((id) => lots.has(id)).map((id) => ({ id, lotNo: (lots.get(id) as { lotNo: string }).lotNo })),
  } as unknown as PastCaseRepository;
  let model: string | null;
  let llmReply: () => Promise<unknown>;
  const service = () =>
    new PastCaseService(
      {} as PrismaService,
      repository,
      new PastCaseStore(),
      { read: async () => ({ baseUrl: 'http://127.0.0.1:1234/v1', model, apiKey: null }) } as unknown as LlmSettingsStore,
      { chatJson: () => llmReply() } as unknown as LlmClient,
    );

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fs-past-case-'));
    process.env.STORAGE_DIR = dir;
    model = 'qwen';
    llmReply = async () => ({ caseCategory: 'QUALITY', title: 'SM355A 히트 망가니즈 초과', phenomenon: '망가니즈 1.68%로 기준 초과예요.', cause: '확인 필요', actionTaken: '확인 필요', equipmentText: '' });
  });

  afterEach(async () => {
    process.env.STORAGE_DIR = before;
    await rm(dir, { recursive: true, force: true });
  });

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

  it('등록하면 CASE-0006부터 번호를 매겨 파일에 남기고, 검색·상세에 함께 나온다', async () => {
    const input = { caseCategory: 'QUALITY' as const, title: 'SM355A 히트 망가니즈 초과', phenomenon: '현상', cause: '', actionTaken: '', equipmentText: '', occurredDate: '2026-10-14', lotIds: [101, 101, 102] };
    const first = await service().create(QUALITY_USER, input);
    const [second] = await Promise.all([service().create(QUALITY_USER, input)]);
    expect(first).toMatchObject({ id: 6, caseNo: 'CASE-0006', isExample: false, createdEmployeeName: '서민지', lots: [{ lotId: 101 }, { lotId: 102 }] });
    expect(second?.caseNo).toBe('CASE-0007');
    const saved = JSON.parse(await readFile(join(dir, 'past-cases', 'cases.json'), 'utf8')) as { cases: { createdEmployeeId: number }[] };
    expect(saved.cases).toHaveLength(2);
    expect(saved.cases[0]?.createdEmployeeId).toBe(13);
    expect((await service().search({ q: '망가니즈 초과' }))[0]?.caseNo).toBe('CASE-0007');
    expect((await service().detail(6)).caseNo).toBe('CASE-0006');
    await expect(service().detail(99)).rejects.toMatchObject({ code: 'COM-003' });
  });

  it('같은 서비스로 동시에 등록해도 번호가 겹치지 않는다', async () => {
    const s = service();
    const input = { caseCategory: 'EQUIPMENT' as const, title: 't', phenomenon: 'p', cause: '', actionTaken: '', equipmentText: '', occurredDate: '2026-10-14', lotIds: [101] };
    const created = await Promise.all([s.create(QUALITY_USER, input), s.create(QUALITY_USER, input), s.create(QUALITY_USER, input)]);
    expect(created.map((c) => c.caseNo).sort()).toEqual(['CASE-0006', 'CASE-0007', 'CASE-0008']);
  });

  it('없는 LOT·오늘 뒤 발생일은 등록하지 않는다', async () => {
    const input = { caseCategory: 'QUALITY' as const, title: 't', phenomenon: 'p', cause: '', actionTaken: '', equipmentText: '', occurredDate: '2026-10-14', lotIds: [999] };
    await expect(service().create(QUALITY_USER, input)).rejects.toMatchObject({ code: 'COM-003' });
    await expect(service().create(QUALITY_USER, { ...input, lotIds: [101], occurredDate: '2999-01-01' })).rejects.toMatchObject({ code: 'COM-004' });
  });
});
