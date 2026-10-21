import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  BUSINESS_EVENT_TYPE,
  INSPECTION_RESULT,
  LOT_TYPE,
  PAST_CASE_EXAMPLES,
  canModifyPastCase,
  formatCaseNo,
  searchPastCases,
  type AuthUser,
  type CreatePastCaseInput,
  type PastCaseCategory,
  type PastCaseDraftView,
  type PastCaseSearchInput,
  type PastCaseView,
  type UpdatePastCaseInput,
} from '@fantasteel/shared';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmClient } from '../llm/llm.client';
import { llmEndpointOf, LlmSettingsStore } from '../llm/llm-settings.store';
import { LLM_PROFILE } from '../llm/llm-profiles';
import { DRAFT_JSON_SCHEMA, buildDraftMessages, parseDraft, ruleDraft, similarQueryOf, type FailedItemFact, type FailureFacts } from './past-case.draft';
import { PastCaseRepository, type PastCaseRow } from './past-case.repository';

/** 초안은 화면이 기다리는 동안 써야 해서 AI 어시스턴트(120초)보다 짧게 둔다. 넘으면 검사 결과 초안을 준다 */
const DRAFT_TIMEOUT_MS = 60_000;
const DRAFT_MAX_TOKENS = 1200;
const DRAFT_REFERENCE_LIMIT = 3;

type DraftLot = NonNullable<Awaited<ReturnType<PastCaseRepository['findLot']>>>;

/**
 * 과거 사례 (EX, REQ-CASE-001~005, API-267~270, docs/backend/past-case.md).
 * 예시 사례(shared PAST_CASE_EXAMPLES, 관련 LOT이 실제 LOT이 아니라 DB에 넣지 않음)와 등록 사례(past_case)를 합쳐 쓴다.
 * 등록은 같은 트랜잭션에서 작업 로그 CASE_REGISTERED를 남긴다. 수정·삭제는 맞는 작업 로그 유형이 없어 서버 로그에 변경 전 값을 남긴다.
 */
@Injectable()
export class PastCaseService {
  private readonly logger = new Logger(PastCaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: PastCaseRepository,
    private readonly businessEventRecorder: BusinessEventRecorder,
    private readonly llmSettings: LlmSettingsStore,
    private readonly llm: LlmClient,
  ) {}

  /** 예시 사례 + 등록 사례 */
  async all(): Promise<PastCaseView[]> {
    const registered = await this.repository.findCases(this.prisma);
    return [...registered.map(viewOf), ...PAST_CASE_EXAMPLES];
  }

  /** API-267 과거 사례 검색 */
  async search(input: PastCaseSearchInput): Promise<PastCaseView[]> {
    return searchPastCases(await this.all(), input, seoulToday());
  }

  /** API-268 과거 사례 상세 */
  async detail(id: number): Promise<PastCaseView> {
    const found = (await this.all()).find((c) => c.id === id);
    if (!found) throw new AppException('COM-003', '과거 사례를 찾을 수 없어요');
    return found;
  }

  /**
   * API-269 사례 초안. 불합격 LOT(자기 검사 불합격 또는 상위 히트 성분 불합격)만 쓴다.
   * AI가 실패해도(모델 미설정·연결 실패·시간 초과·이상한 답) 오류로 끝내지 않고 검사 결과로 채운 초안과 이유를 준다.
   */
  async createDraft(lotId: number): Promise<PastCaseDraftView> {
    const lot = await this.repository.findLot(this.prisma, lotId);
    if (!lot) throw new AppException('COM-003', 'LOT을 찾을 수 없어요');
    const facts = await this.failureFactsOf(lot);
    if (!facts) throw new AppException('COM-004', '불합격 판정된 LOT만 사례로 등록할 수 있어요', 409);

    const similar = (await this.search({ q: similarQueryOf(facts) })).slice(0, DRAFT_REFERENCE_LIMIT);
    const base = {
      lot: { lotId: lot.id, lotNo: lot.lotNo, lotType: lot.lotType, steelGradeCode: steelGradeOf(lot) },
      occurredDate: facts.inspectedDate,
      referenceCaseNos: similar.map((c) => c.caseNo),
    };
    const ai = await this.aiDraft(facts, similar);
    if (ai.fields) return { ...base, ...ai.fields, aiWritten: true, aiNotice: null };
    return { ...base, ...ruleDraft(facts), aiWritten: false, aiNotice: `AI 초안을 만들지 못해 검사 결과로 초안을 채웠어요. ${ai.reason}` };
  }

  /** API-270 과거 사례 등록. 관련 LOT은 실제 LOT만 받는다 */
  async create(user: AuthUser, input: CreatePastCaseInput): Promise<PastCaseView> {
    const lotIds = await this.checkedLotIds(input);
    const id = await this.prisma.$transaction(async (tx) => {
      // 사례 번호(CASE-{id})가 id에서 나와서, 겹치지 않는 임시 번호로 만든 뒤 같은 트랜잭션에서 번호를 채운다
      const created = await this.repository.createCase(tx, { caseNo: `PENDING-${randomUUID()}`, ...fieldsOf(input), createdEmployeeId: user.employeeId }, lotIds);
      const caseNo = formatCaseNo(created.id);
      await this.repository.updateCaseNo(tx, created.id, caseNo);
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.CASE_REGISTERED,
        actor: user,
        target: { table: 'past_case', id: created.id },
        lotIds,
        after: { caseNo, ...input, lotIds },
      });
      return created.id;
    });
    const saved = await this.repository.findCase(this.prisma, id);
    if (!saved) throw new AppException('COM-003', '과거 사례를 찾을 수 없어요');
    this.logger.log(`과거 사례 등록 ${saved.caseNo} (사원 ${user.employeeId})`);
    return viewOf(saved);
  }

  /**
   * 과거 사례 수정. 등록과 같은 항목을 모두 다시 받아 바꾼다(번호·등록자·등록 시각은 그대로). 예시 사례는 DB에 없어 고치지 않는다.
   * 맞는 작업 로그 유형이 없어(CASE_REGISTERED는 등록만) 변경 전 값을 서버 로그에 남긴다 (docs/backend/past-case.md).
   */
  async update(user: AuthUser, id: number, input: UpdatePastCaseInput): Promise<PastCaseView> {
    this.assertRegisteredCase(id);
    const lotIds = await this.checkedLotIds(input);
    const before = await this.prisma.$transaction(async (tx) => {
      const found = await this.repository.findCase(tx, id);
      if (!found) throw new AppException('COM-003', '과거 사례를 찾을 수 없어요');
      this.assertCanModify(user, found);
      const stale = () => new AppException('COM-001', '그 사이 다른 곳에서 사례를 고쳤어요. 새로 불러와 주세요');
      if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== found.updatedAt.getTime()) throw stale();
      if (!(await this.repository.updateCase(tx, id, found.updatedAt, fieldsOf(input), lotIds))) throw stale();
      return found;
    });
    const saved = await this.repository.findCase(this.prisma, id);
    if (!saved) throw new AppException('COM-003', '과거 사례를 찾을 수 없어요');
    this.logger.log(`과거 사례 수정 ${saved.caseNo} (사원 ${user.employeeId}) 변경 전 ${JSON.stringify(viewOf(before))}`);
    return viewOf(saved);
  }

  /** 과거 사례 삭제. 관련 LOT 연결도 함께 지운다. 지운 사례를 돌려준다. 작업 로그 대신 서버 로그에 지운 내용을 남긴다 */
  async remove(user: AuthUser, id: number): Promise<PastCaseView> {
    this.assertRegisteredCase(id);
    const removed = await this.prisma.$transaction(async (tx) => {
      const found = await this.repository.findCase(tx, id);
      if (!found) throw new AppException('COM-003', '과거 사례를 찾을 수 없어요');
      this.assertCanModify(user, found);
      if (!(await this.repository.deleteCase(tx, id))) throw new AppException('COM-003', '과거 사례를 찾을 수 없어요');
      return found;
    });
    this.logger.log(`과거 사례 삭제 ${removed.caseNo} (사원 ${user.employeeId}) 지운 내용 ${JSON.stringify(viewOf(removed))}`);
    return viewOf(removed);
  }

  /** 등록한 사원 본인, 그 사원 소속 부서의 부서장, 관리자만 고치거나 지운다 (컨트롤러는 DISPOSITION_SET 사용 권한까지만 본다) */
  private assertCanModify(user: AuthUser, row: PastCaseRow): void {
    if (!canModifyPastCase(user, viewOf(row))) throw new AppException('COM-002', '사례를 등록한 사원, 그 사원의 부서장, 관리자만 고치거나 지울 수 있어요');
  }

  /** 예시 사례(id 1~5)는 DB에 없는 화면용 사례라 고치거나 지우지 못한다 */
  private assertRegisteredCase(id: number): void {
    if (PAST_CASE_EXAMPLES.some((example) => example.id === id)) throw new AppException('COM-004', '예시 사례는 고치거나 지울 수 없어요', 409);
  }

  /** 관련 LOT은 실제 LOT만, 발생일은 오늘까지. 중복을 뺀 LOT id를 돌려준다 */
  private async checkedLotIds(input: CreatePastCaseInput): Promise<number[]> {
    const lotIds = [...new Set(input.lotIds)];
    const lots = await this.repository.findLotNos(this.prisma, lotIds);
    if (lots.length !== lotIds.length) throw new AppException('COM-003', '관련 LOT을 찾을 수 없어요');
    if (input.occurredDate > seoulToday()) throw new AppException('COM-004', '발생일은 오늘보다 뒤일 수 없어요');
    return lotIds;
  }

  /** 자기 검사가 불합격이면 그 값, 아니면 위로 올라가며 성분 불합격인 히트를 찾는다(코일 → 슬래브 → 히트) */
  private async failureFactsOf(lot: DraftLot): Promise<FailureFacts | null> {
    if (lot.qualityInspection?.inspectionResult === INSPECTION_RESULT.FAIL) return factsOf(lot, lot, null);
    let frontier: DraftLot[] = [lot];
    for (let depth = 0; depth < 2 && frontier.length; depth++) {
      const parents = (await Promise.all(frontier.map((l) => this.repository.findParentLots(this.prisma, l.id)))).flat().map((r) => r.parentLot);
      const failedHeat = parents.find((p) => p.lotType === LOT_TYPE.HEAT && p.qualityInspection?.inspectionResult === INSPECTION_RESULT.FAIL);
      if (failedHeat) return factsOf(lot, failedHeat, failedHeat.lotNo);
      frontier = parents.filter((p) => p.lotType === LOT_TYPE.SLAB || p.lotType === LOT_TYPE.HEAT);
    }
    return null;
  }

  private async aiDraft(facts: FailureFacts, similar: PastCaseView[]): Promise<{ fields: ReturnType<typeof parseDraft>; reason: string }> {
    const settings = await this.llmSettings.read();
    if (!settings.model) return { fields: null, reason: 'AI 모델이 아직 정해지지 않았어요.' };
    try {
      const raw = await this.llm.chatJson(llmEndpointOf(settings), settings.model, buildDraftMessages(facts, similar), DRAFT_JSON_SCHEMA, {
        timeoutMs: DRAFT_TIMEOUT_MS,
        maxTokens: DRAFT_MAX_TOKENS,
        profile: LLM_PROFILE.PAST_CASE_DRAFT,
      });
      const fields = parseDraft(raw);
      return fields ? { fields, reason: '' } : { fields: null, reason: 'AI 답의 형식이 맞지 않았어요.' };
    } catch (error) {
      this.logger.warn(`사례 초안 AI 실패: ${error instanceof Error ? error.message : String(error)}`);
      return { fields: null, reason: 'AI에 연결하지 못했거나 답이 늦었어요.' };
    }
  }
}

/** 입력의 사례 항목 (빈 원인·조치·설비는 NULL로 저장) */
function fieldsOf(input: CreatePastCaseInput) {
  return {
    caseCategory: input.caseCategory,
    title: input.title,
    phenomenon: input.phenomenon,
    cause: input.cause || null,
    actionTaken: input.actionTaken || null,
    equipmentText: input.equipmentText || null,
    occurredDate: new Date(`${input.occurredDate}T00:00:00.000Z`),
  };
}

function viewOf(row: PastCaseRow): PastCaseView {
  return {
    id: row.id,
    caseNo: row.caseNo,
    caseCategory: row.caseCategory as PastCaseCategory,
    title: row.title,
    phenomenon: row.phenomenon,
    cause: row.cause ?? '',
    actionTaken: row.actionTaken ?? '',
    equipmentText: row.equipmentText ?? '',
    lots: row.pastCaseLots.map(({ lot }) => ({ lotId: lot.id, lotNo: lot.lotNo })),
    occurredDate: row.occurredDate.toISOString().slice(0, 10),
    createdEmployeeName: row.createdEmployee.employeeName,
    createdEmployeeId: row.createdEmployeeId,
    createdEmployeeDepartmentId: row.createdEmployee.departmentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isExample: false,
  };
}

function steelGradeOf(lot: DraftLot): string | null {
  return lot.steelGrade?.steelGradeCode ?? lot.item?.steelGrade?.steelGradeCode ?? null;
}

function factsOf(lot: DraftLot, inspected: DraftLot, viaLotNo: string | null): FailureFacts {
  const inspection = inspected.qualityInspection;
  const failedItems: FailedItemFact[] = (inspection?.qualityInspectionValues ?? [])
    .filter((v) => {
      const { minValue, maxValue } = v.inspectionStandardItem;
      return (minValue !== null && v.measuredValue.lt(minValue)) || (maxValue !== null && v.measuredValue.gt(maxValue));
    })
    .map((v) => ({
      name: v.inspectionStandardItem.inspectionItemName,
      code: v.inspectionStandardItem.inspectionItemCode,
      value: v.measuredValue.toString(),
      unit: v.inspectionStandardItem.unit,
      min: v.inspectionStandardItem.minValue?.toString() ?? null,
      max: v.inspectionStandardItem.maxValue?.toString() ?? null,
    }));
  return {
    lotNo: lot.lotNo,
    lotType: lot.lotType,
    steelGradeCode: steelGradeOf(lot),
    processType: inspection?.inspectionStandard.processType ?? null,
    inspectedDate: seoulToday(inspection?.inspectedAt ?? new Date()),
    failedItems,
    dispositionStatus: lot.dispositionStatus,
    dispositionReason: lot.dispositionReason,
    viaLotNo,
  };
}
