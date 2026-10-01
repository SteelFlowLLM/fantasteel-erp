// 검사 기준 버전 만들기 (REQ-QC-002, TRM-110, 컨벤션 7-2 "검사 기준은 새 버전으로 추가").
// - 기준을 바꾸면 같은 코드로 버전 + 1인 새 행을 만들고, 이전 버전은 is_current = false로 남긴다(읽기 전용).
//   이전 버전으로 판정한 검사 기록(quality_inspection.inspection_standard_id)은 그대로 그 버전을 가리킨다.
// - 새 기준(공정 × 강종)은 버전 1로 만든다. 코드는 QS-강종-공정 (예: QS-SM355A-HR).
// - 입력 확인(항목 형식·두께 구간 겹침)은 api/inspectionStandards.ts가 먼저 하고, 이 서비스는 버전 규칙과 참조만 확인한다.
// 순환 참조를 피하려고 오류는 @/api/errors에서 가져온다 (docs/rework/areas/cross-cutting.md 9장).
import { ApiError, InputError } from '@/api/errors';
import { PROCESS_TYPE_LABEL } from '@/codes';
import {
  formatInspectionStandardCode,
  isInspectedProcess,
  type InspectedProcessType,
} from '@/features/inspectionStandards/lib/standardItems';
import { withIGa } from '@/lib/josa';
import type { InspectionStandardRow } from '@/mock/schema';
import { currentStandardOf } from '@/mock/services/context';
import { insertRow, updateRow, type MockTx } from '@/mock/store';

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

export type CreateInspectionStandardVersionInput =
  | {
      /** 지금 버전(화면이 보고 고친 버전)의 id. 그사이 다른 곳에서 새 버전이 생겼으면 COM-001 */
      baseStandardId: number;
      items: readonly InspectionStandardItemValues[];
    }
  | {
      baseStandardId: null;
      processType: InspectedProcessType;
      /** null = 공통 기준(모든 강종) */
      steelGradeId: number | null;
      items: readonly InspectionStandardItemValues[];
    };

function insertItems(tx: MockTx, standardId: number, items: readonly InspectionStandardItemValues[]): void {
  for (const item of items) insertRow(tx, 'inspectionStandardItem', { inspectionStandardId: standardId, ...item });
}

const nextVersionOf = (tx: MockTx, code: string) => tx.tables.inspectionStandard.filter((s) => s.inspectionStandardCode === code).reduce((max, s) => Math.max(max, s.version), 0) + 1;

/** 검사 기준의 새 버전(또는 새 기준의 버전 1)을 만든다. 만든 버전 행을 돌려준다. */
export function createInspectionStandardVersion(tx: MockTx, input: CreateInspectionStandardVersionInput): InspectionStandardRow {
  if (input.items.length === 0) throw new InputError('검사 항목을 1개 이상 넣어 주세요');

  if (input.baseStandardId !== null) {
    const base = tx.tables.inspectionStandard.find((s) => s.id === input.baseStandardId);
    if (!base) throw new ApiError('COM-003', '검사 기준');
    if (!base.isCurrent) {
      throw new ApiError('COM-001', '검사 기준이 다른 곳에서 먼저 새 버전으로 바뀌었어요. 지금 버전을 확인하고 다시 만들어 주세요');
    }
    // 같은 코드의 다른 버전이 지금 버전으로 남아 있으면 모두 내린다 (지금 버전은 늘 하나)
    for (const other of tx.tables.inspectionStandard.filter((s) => s.inspectionStandardCode === base.inspectionStandardCode && s.isCurrent)) {
      updateRow(tx, 'inspectionStandard', other.id, { isCurrent: false });
    }
    const created = insertRow(tx, 'inspectionStandard', {
      inspectionStandardCode: base.inspectionStandardCode,
      version: nextVersionOf(tx, base.inspectionStandardCode),
      processType: base.processType,
      steelGradeId: base.steelGradeId,
      isCurrent: true,
    });
    insertItems(tx, created.id, input.items);
    return created;
  }

  if (!isInspectedProcess(input.processType)) throw new InputError('검사하는 공정이 아니에요', { processType: '제강·연주·열연 중에서 골라 주세요' });
  const grade = input.steelGradeId === null ? null : tx.tables.steelGrade.find((g) => g.id === input.steelGradeId);
  if (grade === undefined) throw new ApiError('COM-003', '강종');
  const existing = tx.tables.inspectionStandard.find((s) => s.isCurrent && s.processType === input.processType && s.steelGradeId === (grade?.id ?? null));
  if (existing) {
    throw new InputError('이미 있는 검사 기준이에요', {
      processType: `${withIGa(`${existing.inspectionStandardCode}(${PROCESS_TYPE_LABEL[input.processType]})`)} 이미 있어요. 그 기준에서 새 버전을 만들어 주세요`,
    });
  }
  const code = formatInspectionStandardCode(grade?.steelGradeCode ?? null, input.processType);
  const created = insertRow(tx, 'inspectionStandard', {
    inspectionStandardCode: code,
    version: nextVersionOf(tx, code),
    processType: input.processType,
    steelGradeId: grade?.id ?? null,
    isCurrent: true,
  });
  insertItems(tx, created.id, input.items);
  return created;
}

/** 공정·강종에 쓰는 지금 버전 (강종 전용 → 없으면 공통). 검사 입력이 판정 기준을 고를 때 쓴다. */
export function currentInspectionStandardOf(tx: Pick<MockTx, 'tables'>, processType: InspectedProcessType, steelGradeId: number): InspectionStandardRow | undefined {
  return currentStandardOf(tx.tables, processType, steelGradeId);
}
