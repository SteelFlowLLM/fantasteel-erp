// 검사 기준 조회·버전 만들기 (REQ-QC-002, REQ-MST-002 성분 규격 = 제강 검사 기준, TRM-110·075).
// - 품질 담당이 관리한다: 변경은 검사 기준 관리(INSPECTION_STANDARD_MANAGE) 사용 권한을 다시 확인한다 (없으면 COM-002).
// - 고치는 대신 새 버전을 만든다(mock/services/inspectionStandards.ts). 이전 버전은 읽기 전용으로 남는다.
// - 검사 기준 변경에 맞는 BUSINESS_EVENT_TYPE이 공통 코드 29개 안에 없어 작업 로그는 남기지 않는다 (docs/rework/areas/master.md).
import { PERMISSION, type ProcessType } from '@/codes';
import { requireActor } from '@/api/actor';
import { FieldErrors, InputError, mockMutation, mockQuery } from '@/api/client';
import { decimalText, optionalText, requiredText } from '@/api/validation';
import { canHaveCommonStandard, findOverlappingItems, isInspectedProcess, type InspectedProcessType } from '@/features/inspectionStandards/lib/standardItems';
import { withEunNeun } from '@/lib/josa';
import { compareDecimal, formatDecimal } from '@/lib/weight';
import type { InspectionStandardItemRow, InspectionStandardRow, MockTables } from '@/mock/schema';
import { createInspectionStandardVersion, type InspectionStandardItemValues } from '@/mock/services/inspectionStandards';

export const inspectionStandardKeys = {
  all: ['inspection-standards'] as const,
  list: (query: InspectionStandardListQuery = {}) => ['inspection-standards', 'list', query] as const,
  detail: (id: number) => ['inspection-standards', 'detail', id] as const,
};

export interface InspectionStandardListQuery {
  processType?: InspectedProcessType;
  steelGradeId?: number;
}

export interface InspectionStandardSummaryView {
  id: number;
  inspectionStandardCode: string;
  version: number;
  processType: ProcessType;
  steelGradeId: number | null;
  /** null = 공통 기준 */
  steelGradeCode: string | null;
  itemCount: number;
  versionCount: number;
  createdAt: string;
}

export interface InspectionStandardItemView {
  id: number;
  inspectionItemCode: string;
  inspectionItemName: string;
  unit: string | null;
  minValue: string | null;
  maxValue: string | null;
  minThicknessMm: string | null;
  maxThicknessMm: string | null;
  isRequired: boolean;
  sortOrder: number;
}

export interface InspectionStandardVersionBrief {
  id: number;
  version: number;
  isCurrent: boolean;
  createdAt: string;
  itemCount: number;
  /** 이 버전으로 판정한 품질검사 수 */
  inspectionCount: number;
}

export interface InspectionStandardDetailView extends InspectionStandardSummaryView {
  isCurrent: boolean;
  /** 강종의 적용 규격 번호 (공통 기준이면 null) */
  standardNo: string | null;
  items: InspectionStandardItemView[];
  /** 바로 앞 버전의 항목 (버전 1이면 null) — 바뀐 항목 표시용 */
  previousItems: InspectionStandardItemView[] | null;
  /** 같은 코드의 모든 버전 (새 버전이 위) */
  versions: InspectionStandardVersionBrief[];
  /** 지금 버전의 id */
  currentId: number;
  inspectionCount: number;
}

/** 화면 입력 그대로의 검사 항목 (숫자는 글자) */
export interface InspectionStandardItemInput {
  inspectionItemCode: string;
  inspectionItemName: string;
  unit: string;
  minValue: string;
  maxValue: string;
  minThicknessMm: string;
  maxThicknessMm: string;
  isRequired: boolean;
}

export interface InspectionStandardVersionInput {
  /** 화면이 보고 고친 지금 버전의 id */
  baseStandardId: number;
  items: InspectionStandardItemInput[];
}

/** 공통 기준(모든 강종)을 고른 값. 강종을 고르지 않은 것(null)과 구분한다 */
export const COMMON_STANDARD_GRADE = 'COMMON';

export interface InspectionStandardCreateInput {
  processType: ProcessType | null;
  /** 강종 id · COMMON_STANDARD_GRADE = 공통 기준(연주·열연만) · null = 아직 고르지 않음(거부) */
  steelGradeId: number | typeof COMMON_STANDARD_GRADE | null;
  items: InspectionStandardItemInput[];
}

/** 항목 코드: 영문으로 시작하고 영문·숫자·밑줄 (예: C, Si, TENSILE_STRENGTH) */
const ITEM_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const VALUE_RULE = { scale: 4, integerDigits: 8, allowNegative: true } as const;
const THICKNESS_RULE = { scale: 2, integerDigits: 6 } as const;

/** 검사 항목 입력 확인. 입력칸 키 = items.{행}.{칸} */
export function readStandardItems(items: readonly InspectionStandardItemInput[]): InspectionStandardItemValues[] {
  if (items.length === 0) throw new InputError('검사 항목을 1개 이상 넣어 주세요');
  const errors = new FieldErrors();
  const values = items.map((item, index): InspectionStandardItemValues | null => {
    const buildKey = (field: string) => `items.${index}.${field}`;
    const code = requiredText(errors, buildKey('inspectionItemCode'), item.inspectionItemCode, '항목 코드', 50);
    if (code && !ITEM_CODE_PATTERN.test(code)) errors.add(buildKey('inspectionItemCode'), '영문으로 시작하고 영문·숫자·밑줄만 써요 (예: C, TENSILE_STRENGTH)');
    const name = requiredText(errors, buildKey('inspectionItemName'), item.inspectionItemName, '항목명', 50);
    const unit = optionalText(errors, buildKey('unit'), item.unit, '단위', 20);
    const minValue = decimalText(errors, buildKey('minValue'), item.minValue, { label: '최소', ...VALUE_RULE });
    const maxValue = decimalText(errors, buildKey('maxValue'), item.maxValue, { label: '최대', ...VALUE_RULE });
    if (minValue === null && maxValue === null) errors.add(buildKey('minValue'), '최소·최대 중 하나는 입력해 주세요');
    if (minValue && maxValue && compareDecimal(minValue, maxValue) > 0) errors.add(buildKey('maxValue'), '최소값이 최대값보다 클 수 없어요');
    const minThickness = decimalText(errors, buildKey('minThicknessMm'), item.minThicknessMm, { label: '두께 하한', ...THICKNESS_RULE });
    const maxThickness = decimalText(errors, buildKey('maxThicknessMm'), item.maxThicknessMm, { label: '두께 상한', ...THICKNESS_RULE });
    if (maxThickness !== undefined && maxThickness !== null && compareDecimal(maxThickness, '0') <= 0) errors.add(buildKey('maxThicknessMm'), `${withEunNeun('두께 상한')} 0보다 커야 해요`);
    if (minThickness && maxThickness && compareDecimal(minThickness, maxThickness) >= 0) {
      errors.add(buildKey('maxThicknessMm'), '두께 상한(이하)은 하한(초과)보다 커야 해요');
    }
    if (!code || !name || minValue === undefined || maxValue === undefined || minThickness === undefined || maxThickness === undefined) return null;
    return {
      inspectionItemCode: code,
      inspectionItemName: name,
      unit,
      minValue: minValue === null ? null : formatDecimal(minValue, 4),
      maxValue: maxValue === null ? null : formatDecimal(maxValue, 4),
      minThicknessMm: minThickness === null ? null : formatDecimal(minThickness, 2),
      maxThicknessMm: maxThickness === null ? null : formatDecimal(maxThickness, 2),
      isRequired: item.isRequired,
      sortOrder: index + 1,
    };
  });
  const valid = values.filter((v): v is InspectionStandardItemValues => v !== null);
  if (valid.length === values.length) {
    for (const [first, second] of findOverlappingItems(valid)) {
      errors.add(`items.${second}.minThicknessMm`, `${first + 1}행과 같은 항목 코드인데 두께 구간이 겹쳐요`);
    }
  }
  errors.throwIfAny('검사 항목을 확인해 주세요');
  return valid;
}

const buildItemView = (row: InspectionStandardItemRow): InspectionStandardItemView => ({
  id: row.id,
  inspectionItemCode: row.inspectionItemCode,
  inspectionItemName: row.inspectionItemName,
  unit: row.unit,
  minValue: row.minValue,
  maxValue: row.maxValue,
  minThicknessMm: row.minThicknessMm,
  maxThicknessMm: row.maxThicknessMm,
  isRequired: row.isRequired,
  sortOrder: row.sortOrder,
});

const listStandardItems = (tables: Readonly<MockTables>, standardId: number) =>
  tables.inspectionStandardItem
    .filter((i) => i.inspectionStandardId === standardId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map(buildItemView);

const PROCESS_ORDER: readonly ProcessType[] = ['STEELMAKING', 'CONTINUOUS_CASTING', 'HOT_ROLLING'];

function buildSummaryView(tables: Readonly<MockTables>, row: InspectionStandardRow): InspectionStandardSummaryView {
  return {
    id: row.id,
    inspectionStandardCode: row.inspectionStandardCode,
    version: row.version,
    processType: row.processType,
    steelGradeId: row.steelGradeId,
    steelGradeCode: tables.steelGrade.find((g) => g.id === row.steelGradeId)?.steelGradeCode ?? null,
    itemCount: tables.inspectionStandardItem.filter((i) => i.inspectionStandardId === row.id).length,
    versionCount: tables.inspectionStandard.filter((s) => s.inspectionStandardCode === row.inspectionStandardCode).length,
    createdAt: row.createdAt,
  };
}

export const inspectionStandardApi = {
  /** 지금 버전 목록 (공정 순서 → 공통 기준 먼저 → 강종 코드) */
  list: (query: InspectionStandardListQuery = {}): Promise<InspectionStandardSummaryView[]> =>
    mockQuery((tables) =>
      tables.inspectionStandard
        .filter((s) => s.isCurrent)
        .filter((s) => !query.processType || s.processType === query.processType)
        .filter((s) => query.steelGradeId === undefined || s.steelGradeId === query.steelGradeId || (s.steelGradeId === null && canHaveCommonStandard(s.processType)))
        .map((s) => buildSummaryView(tables, s))
        .sort(
          (a, b) =>
            PROCESS_ORDER.indexOf(a.processType) - PROCESS_ORDER.indexOf(b.processType) ||
            (a.steelGradeCode === null ? -1 : b.steelGradeCode === null ? 1 : a.steelGradeCode.localeCompare(b.steelGradeCode)),
        ),
    ),

  /** 한 버전의 상세 (이전 버전이면 읽기 전용으로 보인다). 없으면 null. */
  get: (id: number): Promise<InspectionStandardDetailView | null> =>
    mockQuery((tables) => {
      const row = tables.inspectionStandard.find((s) => s.id === id);
      if (!row) return null;
      const siblings = tables.inspectionStandard.filter((s) => s.inspectionStandardCode === row.inspectionStandardCode).sort((a, b) => b.version - a.version);
      const previous = siblings.find((s) => s.version < row.version) ?? null;
      const current = siblings.find((s) => s.isCurrent) ?? siblings[0];
      const countInspections = (standardId: number) => tables.qualityInspection.filter((q) => q.inspectionStandardId === standardId).length;
      return {
        ...buildSummaryView(tables, row),
        isCurrent: row.isCurrent,
        standardNo: tables.steelGrade.find((g) => g.id === row.steelGradeId)?.standardNo ?? null,
        items: listStandardItems(tables, row.id),
        previousItems: previous ? listStandardItems(tables, previous.id) : null,
        versions: siblings.map((s) => ({
          id: s.id,
          version: s.version,
          isCurrent: s.isCurrent,
          createdAt: s.createdAt,
          itemCount: tables.inspectionStandardItem.filter((i) => i.inspectionStandardId === s.id).length,
          inspectionCount: countInspections(s.id),
        })),
        currentId: current?.id ?? row.id,
        inspectionCount: countInspections(row.id),
      };
    }),

  /** 지금 버전을 바탕으로 새 버전을 만든다. 새 버전 id를 돌려준다. */
  createVersion: (input: InspectionStandardVersionInput): Promise<number> =>
    mockMutation((tx) => {
      requireActor(tx.tables, { use: [PERMISSION.INSPECTION_STANDARD_MANAGE] });
      const items = readStandardItems(input.items);
      return createInspectionStandardVersion(tx, { baseStandardId: input.baseStandardId, items }).id;
    }),

  /** 새 검사 기준(공정 × 강종)을 버전 1로 만든다. 새 기준 id를 돌려준다. */
  create: (input: InspectionStandardCreateInput): Promise<number> =>
    mockMutation((tx) => {
      requireActor(tx.tables, { use: [PERMISSION.INSPECTION_STANDARD_MANAGE] });
      const errors = new FieldErrors();
      const processType = input.processType && isInspectedProcess(input.processType) ? input.processType : null;
      if (!processType) errors.add('processType', '제강·연주·열연 중에서 골라 주세요');
      if (input.steelGradeId === null) errors.add('steelGradeId', '강종을 선택해 주세요');
      else if (input.steelGradeId === COMMON_STANDARD_GRADE && processType && !canHaveCommonStandard(processType)) {
        errors.add('steelGradeId', '제강 검사 기준은 강종별로 만들어요. 강종을 선택해 주세요');
      }
      errors.throwIfAny('공정·강종을 확인해 주세요');
      if (!processType || input.steelGradeId === null) throw new InputError('공정·강종을 확인해 주세요');
      const items = readStandardItems(input.items);
      const steelGradeId = input.steelGradeId === COMMON_STANDARD_GRADE ? null : input.steelGradeId;
      return createInspectionStandardVersion(tx, { baseStandardId: null, processType, steelGradeId, items }).id;
    }),
};
