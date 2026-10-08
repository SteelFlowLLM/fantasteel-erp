// 검사 기준 화면 ↔ 서버 API (server/src/modules/quality/inspection-standard.*).
// 강종 id는 서버 id 그대로다 (강종 선택은 기준정보 화면과 같은 서버 강종 목록). 적용 규격 번호는 강종 목록에서 읽는다.
// 서버에 아직 없는 것은 빈 값이다:
// - 공통 기준(강종 없음): ERD steel_grade_id NOT NULL이라 서버에는 없다. 공통 기준 만들기는 입력 오류로 막는다.
// 버전 이력·버전별 판정한 검사 수는 상세 응답(versions·inspectionCount)으로, 바로 앞 버전 항목은 그 버전 상세로 읽는다.
// - 표시 순서 컬럼이 ERD에 없어 항목 순서는 서버가 준 순서(등록 순서)다.
import type { InspectionStandardDeleteResult, InspectionStandardDetail, InspectionStandardListItem, PageResult, SteelGradeView } from '@fantasteel/shared';
import { ApiError, InputError } from '@/api/errors';
import { serverRequest } from '@/api/http';
import { seedSteelGradeOf } from '@/api/server/masterIds';
import type {
  InspectionStandardDeleteView,
  InspectionStandardDetailView,
  InspectionStandardItemView,
  InspectionStandardListQuery,
  InspectionStandardSummaryView,
} from '@/api/inspectionStandards';
import type { InspectedProcessType } from '@/features/inspectionStandards/lib/standardItems';
import type { InspectionStandardItemValues } from '@/mock/services/inspectionStandards';

const PAGE_SIZE = 100;

async function allStandards(query: { processType?: InspectedProcessType; steelGradeId?: number } = {}): Promise<InspectionStandardListItem[]> {
  const rows: InspectionStandardListItem[] = [];
  for (let page = 1; ; page++) {
    const result = await serverRequest<PageResult<InspectionStandardListItem>>('GET', '/inspection-standards', { query: { ...query, page, size: PAGE_SIZE } });
    rows.push(...result.items);
    if (rows.length >= result.total || result.items.length === 0) return rows;
  }
}

const toItemView = (item: InspectionStandardListItem['items'][number], index: number): InspectionStandardItemView => ({
  id: item.inspectionStandardItemId,
  inspectionItemCode: item.inspectionItemCode,
  inspectionItemName: item.inspectionItemName,
  unit: item.unit,
  minValue: item.minValue,
  maxValue: item.maxValue,
  minThicknessMm: item.thicknessOverMm,
  maxThicknessMm: item.thicknessUptoMm,
  isRequired: item.isRequired,
  sortOrder: index + 1,
});

/** latestVersionNo: 같은 코드의 최신 버전 번호. 삭제는 코드 단위라 버전은 1부터 빠짐없이 있어 버전 수와 같다 */
function toSummaryView(row: InspectionStandardListItem, latestVersionNo: number): InspectionStandardSummaryView {
  return {
    id: row.inspectionStandardId,
    inspectionStandardCode: row.inspectionStandardCode,
    version: row.versionNo,
    processType: row.processType,
    steelGradeId: row.steelGradeId,
    steelGradeCode: row.steelGradeCode,
    itemCount: row.items.length,
    versionCount: latestVersionNo,
    createdAt: row.createdAt,
  };
}

async function list(query: InspectionStandardListQuery = {}): Promise<InspectionStandardSummaryView[]> {
  const rows = await allStandards({ processType: query.processType });
  return rows.filter((r) => query.steelGradeId === undefined || r.steelGradeId === query.steelGradeId).map((r) => toSummaryView(r, r.versionNo));
}

/** 강종의 적용 규격 번호. 강종 목록(기준정보 조회 권한)을 못 읽으면 시드의 같은 코드에서 찾는다 */
async function standardNoOf(steelGradeCode: string): Promise<string | null> {
  try {
    const grades = await serverRequest<SteelGradeView[]>('GET', '/steel-grades');
    const found = grades.find((g) => g.steelGradeCode === steelGradeCode);
    if (found) return found.standardNo;
  } catch (e) {
    if (!(e instanceof ApiError && e.code === 'COM-002')) throw e;
  }
  return seedSteelGradeOf(steelGradeCode)?.standardNo ?? null;
}

async function get(id: number): Promise<InspectionStandardDetailView | null> {
  let row: InspectionStandardDetail;
  try {
    row = await serverRequest<InspectionStandardDetail>('GET', `/inspection-standards/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'COM-003') return null;
    throw e;
  }
  // 서버는 버전 번호 순, 화면은 새 버전이 위
  const versions = [...row.versions].sort((a, b) => b.versionNo - a.versionNo);
  const latest = versions[0] ?? { inspectionStandardId: row.inspectionStandardId, versionNo: row.versionNo };
  const previous = versions.find((v) => v.versionNo < row.versionNo) ?? null;
  const previousItems =
    previous === null ? null : (await serverRequest<InspectionStandardDetail>('GET', `/inspection-standards/${previous.inspectionStandardId}`)).items.map(toItemView);
  return {
    ...toSummaryView(row, latest.versionNo),
    isCurrent: latest.inspectionStandardId === row.inspectionStandardId,
    standardNo: await standardNoOf(row.steelGradeCode),
    items: row.items.map(toItemView),
    previousItems,
    versions: versions.map((v) => ({
      id: v.inspectionStandardId,
      version: v.versionNo,
      isCurrent: v.inspectionStandardId === latest.inspectionStandardId,
      createdAt: v.createdAt,
      itemCount: v.itemCount,
      inspectionCount: v.inspectionCount,
    })),
    currentId: latest.inspectionStandardId,
    inspectionCount: row.inspectionCount,
  };
}

const toServerItem = (item: InspectionStandardItemValues) => ({
  inspectionItemCode: item.inspectionItemCode,
  inspectionItemName: item.inspectionItemName,
  unit: item.unit,
  minValue: item.minValue,
  maxValue: item.maxValue,
  thicknessOverMm: item.minThicknessMm,
  thicknessUptoMm: item.maxThicknessMm,
  isRequired: item.isRequired,
});

/** 새 기준(버전 1). 입력 확인은 api/inspectionStandards.ts가 먼저 했다. steelGradeId는 서버 강종 id, null = 공통 기준 */
async function create(input: { processType: InspectedProcessType; steelGradeId: number | null; items: readonly InspectionStandardItemValues[] }): Promise<number> {
  if (input.steelGradeId === null) {
    throw new InputError('서버에는 공통 기준이 없어요', { steelGradeId: '서버에는 공통 기준(모든 강종)이 없어요. 강종을 선택해 주세요' });
  }
  const created = await serverRequest<InspectionStandardDetail>('POST', '/inspection-standards', {
    body: { processType: input.processType, steelGradeId: input.steelGradeId, items: input.items.map(toServerItem) },
  });
  return created.inspectionStandardId;
}

/** 새 버전. 서버는 baseStandardId가 최신 버전이 아니면 COM-001로 거부한다 */
async function createVersion(input: { baseStandardId: number; items: readonly InspectionStandardItemValues[] }): Promise<number> {
  const created = await serverRequest<InspectionStandardDetail>('POST', `/inspection-standards/${input.baseStandardId}/versions`, { body: { items: input.items.map(toServerItem) } });
  return created.inspectionStandardId;
}

/** 삭제: 그 코드의 모든 버전. 검사가 쓴 기준이면 서버가 COM-004(입력 오류)로 거부한다 */
async function remove(id: number): Promise<InspectionStandardDeleteView> {
  const result = await serverRequest<InspectionStandardDeleteResult>('DELETE', `/inspection-standards/${id}`);
  return { inspectionStandardCode: result.inspectionStandardCode, deletedVersions: result.deletedVersionNos };
}

export const serverInspectionStandardApi = { list, get, create, createVersion, remove };
