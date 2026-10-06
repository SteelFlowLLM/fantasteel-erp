// 검사 입력 화면 ↔ 서버 API (server/src/modules/quality). 서버 응답을 화면이 쓰는 모양(가짜 DB와 같은 타입)으로 바꾼다.
// 서버 모드에서 LOT은 서버에만 있으므로 LOT id는 서버 id 그대로 쓴다 (화면 주소 ?lot=도 서버 LOT id).
// 서버에 아직 없는 것(연결 수주, 작업 로그, 판정 뒤 자동 예약·여재 결과)은 빈 값이다.
import type {
  InspectedLotSummary,
  InspectionStandardDetail,
  InspectionStandardItemView,
  InspectionStandardListItem,
  PageResult,
  QualityInspectionDetail,
  QualityInspectionSaveResult,
  QualityInspectionDetailItem,
  QualityInspectionListItem,
} from '@fantasteel/shared';
import { ApiError } from '@/api/errors';
import { serverRequest } from '@/api/http';
import type { InspectionDetail, RegisterInspectionOutcome } from '@/api/inspections';
import { appliesToThickness } from '@/lib/inspectionJudgment';
import type { InspectionFormView, InspectionQueueRow, RegisterInspectionInput } from '@/mock/services';

/** 목록은 화면이 한 번에 다 보여 주고 거르므로 서버 최대 페이지 크기로 끝까지 읽는다 */
const PAGE_SIZE = 100;

type FormItem = InspectionFormView['items'][number];
type ListStatus = 'pending' | 'done';

export async function allPages<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const result = await serverRequest<PageResult<T>>('GET', path, { query: { ...query, page, size: PAGE_SIZE } });
    rows.push(...result.items);
    if (rows.length >= result.total || result.items.length === 0) return rows;
  }
}

/** 권한이 없어서 못 읽는 보조 정보(현재 기준 버전·근거 검사)는 빈 값으로 둔다 */
export async function orEmpty<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof ApiError && e.code === 'COM-002') return empty;
    throw e;
  }
}

/** 목록 행과 상세가 같이 쓰는 LOT 정보 + 검사 행 요약 */
type InspectedRow = InspectedLotSummary & Pick<QualityInspectionListItem, 'qualityInspectionId' | 'inspectionStandardCode' | 'versionNo' | 'inspectionResult' | 'inspectedAt'>;

function queueRowOf(row: InspectedRow, inspectorName: string | null = null, locked = false): InspectionQueueRow {
  return {
    lotId: row.lotId,
    lotNo: row.lotNo,
    lotType: row.lotType,
    lotStatus: row.lotStatus,
    itemId: row.itemId,
    itemCode: row.itemCode,
    itemName: row.itemName,
    // 히트는 생산완료일이 없다. 가짜 DB처럼 빈 문자열로 둔다
    producedDate: row.producedDate ?? '',
    productionPlanNo: row.productionPlanNo,
    processType: row.processType,
    steelGradeCode: row.steelGradeCode,
    thicknessMm: row.thicknessMm,
    heatLotId: row.heatLotId,
    heatNo: row.heatLotNo,
    // 서버는 상위 히트에 검사 행이 없으면 null을 준다. 가짜 DB처럼 판정 대기로 본다
    heatResult: row.heatLotId === null ? null : (row.heatInspectionResult ?? 'PENDING'),
    qualityInspectionId: row.qualityInspectionId,
    inspectionResult: row.inspectionResult ?? 'PENDING',
    inspectionStandardCode: row.inspectionStandardCode,
    inspectionStandardVersion: row.versionNo,
    inspectedAt: row.inspectedAt,
    inspectorName,
    // 목록은 isLocked, 상세는 lockedMillSheetNos로 밀시트 잠금을 받는다
    locked,
  };
}

const listOf = (status: ListStatus) => allPages<QualityInspectionListItem>('/quality-inspections', { status });

/** 검사 대상 목록: 판정 대기 먼저(먼저 생긴 LOT부터), 그다음 최근 판정 순. 정렬은 서버가 한다 */
async function queue(): Promise<InspectionQueueRow[]> {
  const [pending, done] = await Promise.all([listOf('pending'), listOf('done')]);
  return [...pending, ...done].map((row) => queueRowOf(row, null, row.isLocked));
}

/**
 * LOT 하나의 검사 목록 행. 서버 목록은 pending·done으로 나뉘어 둘 다 찾는다.
 * 상위 히트가 불합격인 슬래브·코일은 서버 검사 대기 목록에서 빠지므로, 자기 검사 행이 없으면 null이다.
 */
export async function listRowOfLot(lotId: number): Promise<QualityInspectionListItem | null> {
  const find = (status: ListStatus) =>
    serverRequest<PageResult<QualityInspectionListItem>>('GET', '/quality-inspections', { query: { status, lotId, page: 1, size: 1 } }).then((r) => r.items[0] ?? null);
  const [pending, done] = await Promise.all([find('pending'), find('done')]);
  return pending ?? done;
}

/** 이 공정·강종의 최신 기준 버전 (검사 기준 목록은 공정·강종마다 최신 버전 하나). 기준 관리 조회 권한이 없으면 null */
async function currentStandardOf(row: InspectedLotSummary): Promise<InspectionStandardListItem | null> {
  if (row.steelGradeId === null) return null;
  const steelGradeId = row.steelGradeId;
  return orEmpty(
    () =>
      serverRequest<PageResult<InspectionStandardListItem>>('GET', '/inspection-standards', { query: { processType: row.processType, steelGradeId, page: 1, size: 1 } }).then(
        (r) => r.items[0] ?? null,
      ),
    null,
  );
}

const standardView = (s: Pick<InspectionStandardListItem, 'inspectionStandardId' | 'inspectionStandardCode' | 'versionNo'>) => ({
  id: s.inspectionStandardId,
  inspectionStandardCode: s.inspectionStandardCode,
  version: s.versionNo,
});

/** 서버 기준 항목 → 화면 폼 항목. 두께 구간 이름이 다르다(초과 = min, 이하 = max). 표시 순서 컬럼이 없어 서버 순서(id)를 쓴다 */
function formItemOf(item: InspectionStandardItemView | QualityInspectionDetailItem, index: number): FormItem {
  const measured = 'measuredValue' in item ? item : null;
  return {
    inspectionStandardItemId: item.inspectionStandardItemId,
    inspectionItemCode: item.inspectionItemCode,
    inspectionItemName: item.inspectionItemName,
    unit: item.unit,
    minValue: item.minValue,
    maxValue: item.maxValue,
    minThicknessMm: item.thicknessOverMm,
    maxThicknessMm: item.thicknessUptoMm,
    isRequired: item.isRequired,
    sortOrder: index + 1,
    measuredValue: measured?.measuredValue ?? null,
    isPassed: measured?.isPassed ?? null,
  };
}

function formOfInspection(row: QualityInspectionListItem, detail: QualityInspectionDetail, current: InspectionStandardListItem | null): InspectionFormView {
  return {
    lot: queueRowOf({ ...row, ...detail }, detail.inspectorEmployeeName, detail.lockedMillSheetNos.length > 0),
    qualityInspectionId: detail.qualityInspectionId,
    updatedAt: detail.updatedAt,
    inspectionResult: detail.inspectionResult,
    // 현재 버전을 못 읽었으면(권한) 옛 버전 안내를 띄우지 않도록 현재 버전으로 본다
    standard: { ...standardView(detail), isCurrent: current === null || current.inspectionStandardId === detail.inspectionStandardId },
    currentStandard: current ? standardView(current) : null,
    // 서버가 이미 LOT 두께로 걸러 준다
    items: detail.items.map(formItemOf),
    locked: detail.lockedMillSheetNos.length > 0,
    lockedMillSheetNos: detail.lockedMillSheetNos,
  };
}

/** 검사 행이 아직 없는 LOT: 지금 적용될 최신 기준 버전의 항목을 두께 구간(초과~이하)으로 걸러 빈 폼을 만든다 (서버 inspection-judge와 같은 규칙) */
async function formOfStandard(row: QualityInspectionListItem): Promise<InspectionFormView> {
  const standard = row.inspectionStandardId === null ? null : await serverRequest<InspectionStandardDetail>('GET', `/inspection-standards/${row.inspectionStandardId}`);
  const items = (standard?.items ?? []).filter((item) => appliesToThickness({ minThicknessMm: item.thicknessOverMm, maxThicknessMm: item.thicknessUptoMm }, row.thicknessMm));
  return {
    lot: queueRowOf(row),
    qualityInspectionId: null,
    updatedAt: null,
    inspectionResult: 'PENDING',
    standard: standard ? { ...standardView(standard), isCurrent: true } : null,
    currentStandard: standard ? standardView(standard) : null,
    items: items.map(formItemOf),
    locked: false,
    lockedMillSheetNos: [],
  };
}

/** LOT id로 검사 폼을 만든다 (불합격 관리의 근거 검사도 이것을 쓴다) */
export async function inspectionFormOfLot(lotId: number): Promise<InspectionFormView> {
  return (await inspectionOfLot(lotId)).form;
}

/** 검사 폼과 그 목록 행 (상세는 목록 행의 생산계획도 쓴다) */
async function inspectionOfLot(lotId: number): Promise<{ row: QualityInspectionListItem; form: InspectionFormView }> {
  const row = await listRowOfLot(lotId);
  if (!row) throw new ApiError('COM-003', `LOT ${lotId}`);
  if (row.qualityInspectionId === null) return { row, form: await formOfStandard(row) };
  const [detail, current] = await Promise.all([
    serverRequest<QualityInspectionDetail>('GET', `/quality-inspections/${row.qualityInspectionId}`),
    currentStandardOf(row),
  ]);
  return { row, form: formOfInspection(row, detail, current) };
}

async function detail(lotId: number): Promise<InspectionDetail> {
  const { row, form } = await inspectionOfLot(lotId);
  return {
    ...form,
    heatLotId: form.lot.heatLotId,
    productionPlanId: row.productionPlanId,
    // 서버에 아직 없는 것: 연결 수주(LOT 조회 API 없음), 작업 로그 조회
    salesOrderItem: null,
    history: [],
    inspectionItemNames: {},
  };
}

const isBlank = (value: string | null): boolean => value === null || value.trim() === '';

/**
 * 측정값 등록·수정. 검사 행이 없으면 POST(등록), 있으면 PATCH(같은 검사 행 수정·재판정).
 * 빈 칸은 등록에서는 보내지 않고, 수정에서는 null로 보내 저장한 값을 지운다 (서버 PATCH, 2026-10-06 사용자 결정).
 */
async function register(input: RegisterInspectionInput): Promise<RegisterInspectionOutcome> {
  const values = input.values.map((v) => ({
    inspectionStandardItemId: v.inspectionStandardItemId,
    measuredValue: v.measuredValue === null || isBlank(v.measuredValue) ? null : v.measuredValue.trim(),
  }));
  const row = await listRowOfLot(input.lotId);
  if (!row) throw new ApiError('COM-003', `LOT ${input.lotId}`);

  let saved: QualityInspectionSaveResult;
  if (row.qualityInspectionId === null) {
    const filled = values.filter((v) => v.measuredValue !== null);
    saved = await serverRequest<QualityInspectionSaveResult>('POST', '/quality-inspections', { body: { lotId: input.lotId, values: filled } });
  } else {
    // 가짜 DB처럼 화면을 연 시각이 없으면 동시 수정 확인을 하지 않는다 (지금 값을 그대로 보낸다)
    const expectedUpdatedAt = input.expectedUpdatedAt ?? (await serverRequest<QualityInspectionDetail>('GET', `/quality-inspections/${row.qualityInspectionId}`)).updatedAt;
    saved = await serverRequest<QualityInspectionSaveResult>('PATCH', `/quality-inspections/${row.qualityInspectionId}`, { body: { expectedUpdatedAt, values } });
  }
  return {
    lotId: saved.lotId,
    lotNo: saved.lotNo,
    inspectionResult: saved.inspectionResult,
    // 판정 뒤 재고 반영 결과(stockSync). 적격이 된 매수 중 자동 예약하지 못한 것이 여재다. 서버는 여재 LOT 번호를 주지 않는다
    autoReservedQty: saved.stockSync.autoReservedQty,
    surplusLotNos: [],
    surplusQty: Math.max(0, saved.stockSync.eligibleAddedQty - saved.stockSync.autoReservedQty),
    excludedLotQty: saved.stockSync.eligibleRemovedQty,
    releasedAllocationCount: saved.stockSync.releasedAllocationCount,
    releasedReservationQty: saved.stockSync.releasedReservationQty,
    salesOrderItem: null,
  };
}

export const serverInspectionApi = { queue, detail, register };
