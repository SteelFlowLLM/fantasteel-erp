import {
  DISPOSITION_STATUS_LABEL,
  INSPECTION_RESULT_LABEL,
  LOT_TYPE_LABEL,
  PERMISSION,
  PROCESS_TYPE_LABEL,
  QUALITY_INSPECTION_LIST_STATUS,
  type QualityInspectionListItem,
  type QualityInspectionListStatus,
  type RejectedLotListItem,
} from '@fantasteel/shared';
import type { QualityService } from '../../quality/quality.service';
import type { RejectedLotService } from '../../quality/rejected-lot.service';
import { optionalEnum, optionalString, seoulDateTimeText, TOOL_ROW_LIMIT, type AssistantTool } from './assistant-tool';

const LIST_STATUSES = Object.values(QUALITY_INSPECTION_LIST_STATUS) as QualityInspectionListStatus[];
const JUDGED = ['PASS', 'FAIL'] as const;

/** 검사 결과 (GET /quality-inspections, 검사 등록 VIEW) */
export function qualityInspectionTool(quality: QualityService): AssistantTool {
  return {
    access: { checkedBy: 'TOOLBOX', permissions: [PERMISSION.INSPECTION_REGISTER] },
    definition: {
      name: 'get_quality_inspections',
      description:
        '품질검사 대상 LOT과 판정(합격·불합격)을 조회한다. status=pending은 검사 대기, done은 검사 완료. result로 합격·불합격만, lotNo로 LOT 번호 앞부분을 거른다. 상위 히트의 판정도 준다.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: LIST_STATUSES, description: 'pending 검사 대기, done 검사 완료' },
          result: { type: 'string', enum: [...JUDGED], description: 'PASS 합격, FAIL 불합격' },
          lotNo: { type: 'string', description: 'LOT 번호 앞부분' },
        },
      },
    },
    async run(args) {
      const status = optionalEnum(args, 'status', LIST_STATUSES);
      const inspectionResult = optionalEnum(args, 'result', JUDGED);
      const lotNo = optionalString(args, 'lotNo');
      const page = await quality.listQualityInspections({ status, inspectionResult, lotNo, page: 1, size: TOOL_ROW_LIMIT });
      const scope = [status === 'pending' ? '검사 대기' : status === 'done' ? '검사 완료' : null, inspectionResult ? INSPECTION_RESULT_LABEL[inspectionResult] : null, lotNo].filter(Boolean);
      return {
        label: `검사 결과${scope.length ? ` · ${scope.join(' · ')}` : ''}`,
        data: { 'LOT 수': page.total, 검사: page.items.map(inspectionRow), '생략 줄 수': Math.max(0, page.total - page.items.length) },
      };
    },
  };
}

/** 불합격 LOT (GET /lots/rejected). 권한이 "불합격 처리 또는 검사 등록" VIEW라 service가 확인한다 */
export function rejectedLotTool(rejectedLots: RejectedLotService): AssistantTool {
  return {
    access: { checkedBy: 'SERVICE', permissions: [PERMISSION.DISPOSITION_SET, PERMISSION.INSPECTION_REGISTER] },
    definition: {
      name: 'get_rejected_lots',
      description: '불합격 LOT과 불합격 상태(보류·격하·폐기), 불합격 사유, 기준을 벗어난 검사 항목을 조회한다. "불합격 현황"을 물으면 쓴다.',
      parameters: { type: 'object', properties: {} },
    },
    async run(_args, user) {
      const page = await rejectedLots.listRejectedLots({ page: 1, size: TOOL_ROW_LIMIT }, user);
      return {
        label: '불합격 LOT',
        data: { '불합격 LOT 수': page.total, '불합격 LOT': page.items.map(rejectedRow), '생략 줄 수': Math.max(0, page.total - page.items.length) },
      };
    },
  };
}

function lotPart(lot: QualityInspectionListItem | RejectedLotListItem) {
  return {
    'LOT 번호': lot.lotNo,
    유형: LOT_TYPE_LABEL[lot.lotType],
    공정: PROCESS_TYPE_LABEL[lot.processType],
    강종: lot.steelGradeCode,
    규격: lot.itemCode,
    생산완료일: lot.producedDate,
    '생산계획 번호': lot.productionPlanNo,
    '상위 히트': lot.heatLotNo,
    '상위 히트 판정': lot.heatInspectionResult ? INSPECTION_RESULT_LABEL[lot.heatInspectionResult] : null,
  };
}

function inspectionRow(lot: QualityInspectionListItem) {
  return {
    ...lotPart(lot),
    판정: lot.inspectionResult ? INSPECTION_RESULT_LABEL[lot.inspectionResult] : '검사 대기',
    '검사 시각': lot.inspectedAt ? seoulDateTimeText(lot.inspectedAt) : null,
    '검사 기준': lot.inspectionStandardCode ? `${lot.inspectionStandardCode} v${lot.versionNo ?? 1}` : null,
  };
}

function rejectedRow(lot: RejectedLotListItem) {
  return {
    ...lotPart(lot),
    판정: lot.inspectionResult ? INSPECTION_RESULT_LABEL[lot.inspectionResult] : null,
    '불합격 상태': lot.dispositionStatus ? DISPOSITION_STATUS_LABEL[lot.dispositionStatus] : '지정 전',
    '불합격 사유': lot.dispositionReason,
    '기준을 벗어난 항목': (lot.evidence?.failedItems ?? [])
      .filter((item) => item.isPassed === false)
      .map((item) => `${item.inspectionItemName} ${item.measuredValue ?? '-'}${item.unit ?? ''} (기준 ${item.minValue ?? ''}~${item.maxValue ?? ''})`),
  };
}
