import { Injectable, Logger } from '@nestjs/common';
import {
  INSPECTION_RESULT,
  LOT_TYPE,
  PAST_CASE_EXAMPLES,
  formatCaseNo,
  searchPastCases,
  type AuthUser,
  type CreatePastCaseInput,
  type PastCaseDraftView,
  type PastCaseSearchInput,
  type PastCaseView,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmClient } from '../llm/llm.client';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import { DRAFT_JSON_SCHEMA, buildDraftMessages, parseDraft, ruleDraft, similarQueryOf, type FailedItemFact, type FailureFacts } from './past-case.draft';
import { PastCaseRepository } from './past-case.repository';
import { PastCaseStore, type StoredPastCase } from './past-case.store';

/** 등록 사례 번호는 예시 사례(CASE-0001~0005) 다음부터 */
const FIRST_REGISTERED_SEQ = PAST_CASE_EXAMPLES.length + 1;
/** 초안은 화면이 기다리는 동안 써야 해서 AI 어시스턴트(120초)보다 짧게 둔다. 넘으면 검사 결과 초안을 준다 */
const DRAFT_TIMEOUT_MS = 60_000;
const DRAFT_MAX_TOKENS = 1200;
const DRAFT_REFERENCE_LIMIT = 3;

type DraftLot = NonNullable<Awaited<ReturnType<PastCaseRepository['findLot']>>>;

/**
 * 과거 사례 (EX, REQ-CASE-001~005, API-267~270, docs/backend/past-case.md).
 * 기준 ERD에 past_case가 없어 예시 사례(shared PAST_CASE_EXAMPLES)와 등록 사례(PastCaseStore, JSON 파일)를 합쳐 쓴다.
 * 등록은 저장소 파일이라 업무 트랜잭션이 없고, 작업 로그 CASE_REGISTERED는 공통 코드에 없는 제안 코드(🟡)라 남기지 않는다.
 */
@Injectable()
export class PastCaseService {
  private readonly logger = new Logger(PastCaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: PastCaseRepository,
    private readonly store: PastCaseStore,
    private readonly llmSettings: LlmSettingsStore,
    private readonly llm: LlmClient,
  ) {}

  /** 예시 사례 + 등록 사례 */
  async all(): Promise<PastCaseView[]> {
    const stored = await this.store.list();
    return [...stored.map(viewOf), ...PAST_CASE_EXAMPLES];
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
    const lotIds = [...new Set(input.lotIds)];
    const lots = await this.repository.findLotNos(this.prisma, lotIds);
    if (lots.length !== lotIds.length) throw new AppException('COM-003', '관련 LOT을 찾을 수 없어요');
    if (input.occurredDate > seoulToday()) throw new AppException('COM-004', '발생일은 오늘보다 뒤일 수 없어요');
    const lotNoOf = new Map(lots.map((l) => [l.id, l.lotNo]));
    const created = await this.store.append(FIRST_REGISTERED_SEQ, (seq) => ({
      id: seq,
      caseNo: formatCaseNo(seq),
      caseCategory: input.caseCategory,
      title: input.title,
      phenomenon: input.phenomenon,
      cause: input.cause,
      actionTaken: input.actionTaken,
      equipmentText: input.equipmentText,
      lots: lotIds.map((id) => ({ lotId: id, lotNo: lotNoOf.get(id) ?? '' })),
      occurredDate: input.occurredDate,
      createdEmployeeId: user.employeeId,
      createdEmployeeName: user.employeeName,
      createdAt: new Date().toISOString(),
    }));
    this.logger.log(`과거 사례 등록 ${created.caseNo} (사원 ${user.employeeId})`);
    return viewOf(created);
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
      const raw = await this.llm.chatJson({ baseUrl: settings.baseUrl, apiKey: settings.apiKey }, settings.model, buildDraftMessages(facts, similar), DRAFT_JSON_SCHEMA, {
        timeoutMs: DRAFT_TIMEOUT_MS,
        maxTokens: DRAFT_MAX_TOKENS,
      });
      const fields = parseDraft(raw);
      return fields ? { fields, reason: '' } : { fields: null, reason: 'AI 답의 형식이 맞지 않았어요.' };
    } catch (error) {
      this.logger.warn(`사례 초안 AI 실패: ${error instanceof Error ? error.message : String(error)}`);
      return { fields: null, reason: 'AI에 연결하지 못했거나 답이 늦었어요.' };
    }
  }
}

function viewOf(stored: StoredPastCase): PastCaseView {
  const { createdEmployeeId: _createdEmployeeId, ...rest } = stored;
  return { ...rest, isExample: false };
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
