// 검사 기준 조회·버전 만들기·삭제 (REQ-QC-002, REQ-MST-002 성분 규격 = 제강 검사 기준, TRM-110·075).
// - 품질 담당이 관리한다: 변경은 검사 기준 관리(INSPECTION_STANDARD_MANAGE) 사용 권한이 있어야 한다 (서버가 확인, 없으면 COM-002).
// - 고치는 대신 새 버전을 만든다. 이전 버전은 읽기 전용으로 남는다.
// - 삭제는 코드 단위(모든 버전)이고, 어느 버전이든 검사가 판정에 썼으면 거부한다 (서버와 같은 규칙).
// - 검사 기준 변경에 맞는 BUSINESS_EVENT_TYPE이 공통 코드 29개 안에 없어 작업 로그는 남기지 않는다 (docs/rework/areas/master.md).
// 서버를 부른다 (api/server/inspectionStandards.ts). 입력 확인은 서버를 부르기 전에 이 파일에서 먼저 한다.
import { type ProcessType } from '@/codes';
import { FieldErrors, InputError } from '@/api/errors';
import { serverInspectionStandardApi } from '@/api/server/inspectionStandards';
import { decimalText, optionalText, requiredText } from '@/api/validation';
import { canHaveCommonStandard, findOverlappingItems, isInspectedProcess, type InspectedProcessType } from '@/features/inspectionStandards/lib/standardItems';
import { withEunNeun } from '@/lib/josa';
import { compareDecimal, formatDecimal } from '@/lib/weight';

/** 검사 기준 삭제 결과: 지운 기준 코드와 그 코드의 모든 버전 번호 */
export interface InspectionStandardDeleteResult {
  inspectionStandardCode: string;
  deletedVersions: number[];
}

export const inspectionStandardKeys = {
  all: ['inspection-standards'] as const,
  list: (query: InspectionStandardListQuery = {}) => ['inspection-standards', 'list', query] as const,
  detail: (id: number) => ['inspection-standards', 'detail', id] as const,
};

/** 확인을 마친 검사 항목 (decimal은 문자열) */
export interface InspectionStandardItemValues {
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
  /** 이 버전으로 판정한 품질검사 수 */
  inspectionCount: number;
}

/** 삭제 결과: 지운 기준 코드와 그 코드의 모든 버전 번호 */
export type InspectionStandardDeleteView = InspectionStandardDeleteResult;

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

/** 새 기준의 공정·강종 확인. 강종 null = 공통 기준 */
function readCreateTarget(input: InspectionStandardCreateInput): { processType: InspectedProcessType; steelGradeId: number | null } {
  const errors = new FieldErrors();
  const processType = input.processType && isInspectedProcess(input.processType) ? input.processType : null;
  if (!processType) errors.add('processType', '제강·연주·열연 중에서 골라 주세요');
  if (input.steelGradeId === null) errors.add('steelGradeId', '강종을 선택해 주세요');
  else if (input.steelGradeId === COMMON_STANDARD_GRADE && processType && !canHaveCommonStandard(processType)) {
    errors.add('steelGradeId', '제강 검사 기준은 강종별로 만들어요. 강종을 선택해 주세요');
  }
  errors.throwIfAny('공정·강종을 확인해 주세요');
  if (!processType || input.steelGradeId === null) throw new InputError('공정·강종을 확인해 주세요');
  return { processType, steelGradeId: input.steelGradeId === COMMON_STANDARD_GRADE ? null : input.steelGradeId };
}

export const inspectionStandardApi = {
  /** 지금 버전 목록 (공정 순서 → 공통 기준 먼저 → 강종 코드) */
  list: (query: InspectionStandardListQuery = {}): Promise<InspectionStandardSummaryView[]> => serverInspectionStandardApi.list(query),

  /** 한 버전의 상세 (이전 버전이면 읽기 전용으로 보인다). 없으면 null. */
  get: (id: number): Promise<InspectionStandardDetailView | null> => serverInspectionStandardApi.get(id),

  /** 지금 버전을 바탕으로 새 버전을 만든다. 새 버전 id를 돌려준다. */
  createVersion: async (input: InspectionStandardVersionInput): Promise<number> => {
    // 권한은 서버가 확인한다 (COM-002)
    return serverInspectionStandardApi.createVersion({ baseStandardId: input.baseStandardId, items: readStandardItems(input.items) });
  },

  /** 새 검사 기준(공정 × 강종)을 버전 1로 만든다. 새 기준 id를 돌려준다. */
  create: async (input: InspectionStandardCreateInput): Promise<number> => {
    const target = readCreateTarget(input);
    return serverInspectionStandardApi.create({ ...target, items: readStandardItems(input.items) });
  },

  /** 기준 삭제: 이 버전과 같은 코드의 모든 버전을 지운다. 검사가 판정에 쓴 기준이면 입력 오류로 거부한다. */
  remove: (id: number): Promise<InspectionStandardDeleteView> => serverInspectionStandardApi.remove(id),
};
