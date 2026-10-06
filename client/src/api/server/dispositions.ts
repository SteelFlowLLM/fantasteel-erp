// 불합격 관리 화면 ↔ 서버 API (server/src/modules/quality의 rejected-lot). 서버 응답을 화면이 쓰는 모양으로 바꾼다.
// 불합격 항목·검사 시각은 근거 검사(자기 검사, 히트 불합격 하위 LOT이면 상위 히트의 검사) 상세에서 읽는다.
// 서버에 아직 없는 것(지정 시각, 연결 수주·계획, 작업 로그, 재생산 계획)은 빈 값이거나 "서버 연결 전" 오류다.
import type { QualityInspectionDetail, RejectedLotListItem } from '@fantasteel/shared';
import type { RejectedLotDetail, RejectedLotListRow, SetDispositionInput, SetDispositionResult } from '@/api/dispositions';
import { ApiError } from '@/api/errors';
import { serverRequest } from '@/api/http';
import { allPages, inspectionFormOfLot, listRowOfLot, orEmpty } from '@/api/server/inspections';

type FailedItem = RejectedLotListRow['failedItems'][number];
type MeasuredItem = Omit<FailedItem, 'measuredValue'> & { measuredValue: string | null; isPassed: boolean | null };

const rejectedAll = () => allPages<RejectedLotListItem>('/lots/rejected');

/** 자기 검사가 불합격이면 이 LOT 불합격, 아니면 상위 히트 불합격으로 빠진 하위 LOT (TRM-078) */
const reasonOf = (row: RejectedLotListItem): RejectedLotListRow['reason'] => (row.inspectionResult === 'FAIL' ? 'FAILED' : 'HEAT_FAILED');

const failedItemsOf = (items: readonly MeasuredItem[]): FailedItem[] =>
  items
    .filter((i) => i.isPassed === false)
    .map((i) => ({ inspectionItemCode: i.inspectionItemCode, inspectionItemName: i.inspectionItemName, unit: i.unit, minValue: i.minValue, maxValue: i.maxValue, measuredValue: i.measuredValue }));

function listRowOf(row: RejectedLotListItem, evidence: { items: readonly MeasuredItem[]; inspectedAt: string | null } | null): RejectedLotListRow {
  return {
    lotId: row.lotId,
    lotNo: row.lotNo,
    lotType: row.lotType,
    reason: reasonOf(row),
    steelGradeCode: row.steelGradeCode,
    heatNo: row.heatLotNo,
    inspectedAt: evidence?.inspectedAt ?? null,
    failedItems: failedItemsOf(evidence?.items ?? []),
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
    // 서버에 아직 없는 것: 불합격 LOT 응답에 지정 시각이 없고, 연결 수주는 LOT 조회 API가 없다
    dispositionAt: null,
    salesOrderItem: null,
  };
}

/** 근거 검사 id: 자기 검사, 히트 불합격 하위 LOT이면 상위 히트의 검사 (불합격 히트는 보통 같은 목록에 있다) */
async function evidenceInspectionIdOf(row: RejectedLotListItem, ownByLotId: ReadonlyMap<number, number>): Promise<number | null> {
  if (reasonOf(row) === 'FAILED') return row.qualityInspectionId;
  if (row.heatLotId === null) return null;
  const heatLotId = row.heatLotId;
  return ownByLotId.get(heatLotId) ?? orEmpty(() => listRowOfLot(heatLotId).then((r) => r?.qualityInspectionId ?? null), null);
}

/** 불합격 LOT 목록. 근거 검사 상세는 검사 입력 조회 권한이 없으면 비워 둔다 */
async function list(): Promise<RejectedLotListRow[]> {
  const rows = await rejectedAll();
  const ownByLotId = new Map(rows.flatMap((r) => (r.qualityInspectionId === null ? [] : [[r.lotId, r.qualityInspectionId] as const])));
  const evidenceIds = await Promise.all(rows.map((r) => evidenceInspectionIdOf(r, ownByLotId)));
  const uniqueIds = [...new Set(evidenceIds.filter((id): id is number => id !== null))];
  const details = await Promise.all(
    uniqueIds.map((id) => orEmpty<QualityInspectionDetail | null>(() => serverRequest<QualityInspectionDetail>('GET', `/quality-inspections/${id}`), null)),
  );
  const detailById = new Map(uniqueIds.map((id, index) => [id, details[index]]));
  return rows.map((r, index) => {
    const id = evidenceIds[index];
    return listRowOf(r, (id === null ? null : detailById.get(id)) ?? null);
  });
}

/** 불합격 LOT 하나: 근거 검사 폼. 불합격 목록에 없으면 null */
async function detail(lotId: number): Promise<RejectedLotDetail | null> {
  const found = (await rejectedAll()).find((r) => r.lotId === lotId);
  if (!found) return null;
  const evidenceLotId = reasonOf(found) === 'FAILED' ? lotId : found.heatLotId;
  const evidence = evidenceLotId === null ? null : await orEmpty(() => inspectionFormOfLot(evidenceLotId), null);
  return {
    row: listRowOf(found, evidence ? { items: evidence.items, inspectedAt: evidence.lot.inspectedAt } : null),
    evidence,
    // 서버에 아직 없는 것: 같은 수주 품목의 생산계획(생산 모듈), 작업 로그 조회
    plans: [],
    history: [],
    inspectionItemNames: {},
  };
}

/** 불합격 상태 지정. 서버는 expectedUpdatedAt이 꼭 필요해서, 화면을 연 시각이 없으면 지금 목록 행의 값을 쓴다 */
async function set(input: SetDispositionInput): Promise<SetDispositionResult> {
  let expectedUpdatedAt = input.expectedUpdatedAt ?? null;
  if (expectedUpdatedAt === null) {
    const found = (await rejectedAll()).find((r) => r.lotId === input.lotId);
    if (!found) throw new ApiError('COM-003', `불합격 LOT ${input.lotId}`);
    expectedUpdatedAt = found.updatedAt;
  }
  const saved = await serverRequest<RejectedLotListItem>('POST', `/lots/${input.lotId}/disposition`, {
    body: { dispositionStatus: input.dispositionStatus, dispositionReason: input.dispositionReason, expectedUpdatedAt },
  });
  return { lotNo: saved.lotNo, dispositionStatus: saved.dispositionStatus, dispositionReason: saved.dispositionReason, updatedAt: saved.updatedAt };
}

export const serverDispositionApi = { list, detail, set };
