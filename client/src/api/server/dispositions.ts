// 불합격 관리 화면 ↔ 서버 API (server/src/modules/quality의 rejected-lot). 서버 응답을 화면이 쓰는 모양으로 바꾼다.
// 불합격 항목·검사 시각은 서버가 목록 행에 근거 검사(자기 검사, 히트 불합격 하위 LOT이면 상위 히트의 검사)로 같이 준다.
// 연결 수주·부족·같은 수주 품목의 계획은 LOT의 생산계획 상세에서, 재생산 계획은 생산 모듈 API(POST /production-plans)로.
// 서버에 아직 없는 것(지정 시각, 작업 로그)은 빈 값이다.
import type { PageResult, RejectedLotListItem } from '@fantasteel/shared';
import type { ReproductionOutcome, RejectedLotDetail, RejectedLotListRow, SetDispositionInput, SetDispositionResult } from '@/api/dispositions';
import { ApiError } from '@/api/errors';
import { serverRequest } from '@/api/http';
import { allPages, inspectionFormOfLot, linkedOfPlan, orEmpty, type LinkedOfPlan } from '@/api/server/inspections';
import { serverProductionPlanApi } from '@/api/server/production';

const rejectedAll = () => allPages<RejectedLotListItem>('/lots/rejected');

/** 불합격 LOT 하나 (서버가 lotId로 거른다). 불합격이 아니면 null */
const rejectedOne = (lotId: number) =>
  serverRequest<PageResult<RejectedLotListItem>>('GET', '/lots/rejected', { query: { lotId, page: 1, size: 1 } }).then((r) => r.items[0] ?? null);

/** 자기 검사가 불합격이면 이 LOT 불합격, 아니면 상위 히트 불합격으로 빠진 하위 LOT (TRM-078) */
const reasonOf = (row: RejectedLotListItem): RejectedLotListRow['reason'] => (row.inspectionResult === 'FAIL' ? 'FAILED' : 'HEAT_FAILED');

function listRowOf(row: RejectedLotListItem, linked: LinkedOfPlan): RejectedLotListRow {
  const evidence = row.evidence;
  return {
    lotId: row.lotId,
    lotNo: row.lotNo,
    lotType: row.lotType,
    reason: reasonOf(row),
    steelGradeCode: row.steelGradeCode,
    heatNo: row.heatLotNo,
    inspectedAt: evidence?.inspectedAt ?? null,
    // 불합격 항목에는 측정값이 있다 (값이 없으면 판정이 불합격이 아니라 판정 대기)
    failedItems: (evidence?.failedItems ?? []).map((i) => ({
      inspectionItemCode: i.inspectionItemCode,
      inspectionItemName: i.inspectionItemName,
      unit: i.unit,
      minValue: i.minValue,
      maxValue: i.maxValue,
      measuredValue: i.measuredValue ?? '',
    })),
    dispositionStatus: row.dispositionStatus,
    dispositionReason: row.dispositionReason,
    updatedAt: row.updatedAt,
    lotStatus: row.lotStatus,
    itemCode: row.itemCode,
    itemName: row.itemName,
    // 히트는 생산완료일이 없다. 가짜 DB처럼 빈 문자열로 둔다
    producedDate: row.producedDate ?? '',
    productionPlanNo: row.productionPlanNo,
    productionPlanId: row.productionPlanId,
    salesOrderItem: linked.salesOrderItem,
    // 서버에 아직 없는 것: 불합격 LOT 응답에 지정 시각이 없다
    dispositionAt: null,
  };
}

/** 불합격 LOT 목록 (근거 검사의 불합격 항목까지 한 번에 받는다). 연결 수주는 생산계획마다 한 번씩 읽는다 */
async function list(): Promise<RejectedLotListRow[]> {
  const rows = await rejectedAll();
  const planIds = [...new Set(rows.flatMap((r) => (r.productionPlanId === null ? [] : [r.productionPlanId])))];
  const linkedByPlan = new Map(await Promise.all(planIds.map(async (id) => [id, await linkedOfPlan(id)] as const)));
  return rows.map((r) => listRowOf(r, (r.productionPlanId === null ? undefined : linkedByPlan.get(r.productionPlanId)) ?? { salesOrderItem: null, plans: [] }));
}

/** 불합격 LOT 하나: 근거 검사 폼. 불합격 목록에 없으면 null */
async function detail(lotId: number): Promise<RejectedLotDetail | null> {
  const found = await rejectedOne(lotId);
  if (!found) return null;
  // 근거 검사 폼(전체 항목)은 검사 입력 조회 권한이 없으면 비워 둔다. 불합격 항목은 목록 행에 이미 있다
  const evidenceLotId = found.evidence?.lotId ?? null;
  const [evidence, linked] = await Promise.all([
    evidenceLotId === null ? null : orEmpty(() => inspectionFormOfLot(evidenceLotId), null),
    linkedOfPlan(found.productionPlanId),
  ]);
  return {
    row: listRowOf(found, linked),
    evidence,
    plans: linked.plans,
    // 서버에 아직 없는 것: 작업 로그 조회
    history: [],
    inspectionItemNames: {},
  };
}

/** 불합격 상태 지정. 서버는 expectedUpdatedAt이 꼭 필요해서, 화면을 연 시각이 없으면 지금 목록 행의 값을 쓴다 */
async function set(input: SetDispositionInput): Promise<SetDispositionResult> {
  let expectedUpdatedAt = input.expectedUpdatedAt ?? null;
  if (expectedUpdatedAt === null) {
    const found = await rejectedOne(input.lotId);
    if (!found) throw new ApiError('COM-003', `불합격 LOT ${input.lotId}`);
    expectedUpdatedAt = found.updatedAt;
  }
  const saved = await serverRequest<RejectedLotListItem>('POST', `/lots/${input.lotId}/disposition`, {
    body: { dispositionStatus: input.dispositionStatus, dispositionReason: input.dispositionReason, expectedUpdatedAt },
  });
  return { lotNo: saved.lotNo, dispositionStatus: saved.dispositionStatus, dispositionReason: saved.dispositionReason, updatedAt: saved.updatedAt };
}

/** 재생산 계획 (REQ-PRD-006): 생산 모듈의 재생산 API. 같은 규격 여재로 먼저 예약하고 그래도 부족할 때만 계획을 만든다 */
async function createReproductionPlan(input: { salesOrderItemId: number }): Promise<ReproductionOutcome> {
  const result = await serverProductionPlanApi.createReproduction(input);
  return { reservedFromSurplusQty: result.reservedFromSurplusQty, productionPlanNo: result.plan?.productionPlanNo ?? null, shortageQty: result.plan?.shortageQty ?? null };
}

export const serverDispositionApi = { list, detail, set, createReproductionPlan };
