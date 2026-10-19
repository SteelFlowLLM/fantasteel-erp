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
import { seoulToday } from '../../../common/time/seoul-date';
import type { QualityService } from '../../quality/quality.service';
import type { RejectedLotService } from '../../quality/rejected-lot.service';
import { optionalEnum, optionalPositiveInt, optionalString, seoulDateTimeText, ToolArgumentError, TOOL_ROW_LIMIT, type AssistantTool } from './assistant-tool';

const LIST_STATUSES = Object.values(QUALITY_INSPECTION_LIST_STATUS) as QualityInspectionListStatus[];
const JUDGED = ['PASS', 'FAIL'] as const;
const DAY_MS = 86_400_000;
/** 불합격률 기본 기간: 대시보드 강종별 불합격률 위젯과 같은 오늘 포함 최근 30일 (DASHBOARD_TREND_DAYS, docs/rework/areas/dashboard.md 5장 가정값) */
export const REJECT_RATE_DEFAULT_DAYS = 30;
const REJECT_RATE_MAX_DAYS = 365;
/** 검사 목록 API 상한(100) × 쪽 수. 판정이 이보다 많으면 앞(최신)부터 센 만큼만 알린다 */
const REJECT_RATE_PAGE_SIZE = 100;
const REJECT_RATE_MAX_PAGES = 50;

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

/**
 * 강종별 불합격률 (GET /quality-inspections?status=done을 묶는다, 검사 등록 VIEW).
 * 모델은 비율을 직접 계산하지 않으므로(프롬프트 규칙 4) 서버가 대시보드 위젯과 같은 기준으로 센다:
 * 판정 시각(서울 날짜)이 기간 안인 합격·불합격 검사 중 불합격 (client/src/api/server/dashboard.ts rejectRate).
 */
export function qualityRejectRateTool(quality: QualityService): AssistantTool {
  return {
    access: { checkedBy: 'TOOLBOX', permissions: [PERMISSION.INSPECTION_REGISTER] },
    definition: {
      name: 'get_quality_reject_rate',
      description:
        '강종별 불합격률(판정 수·불합격 수·불합격률)과 강종마다 공정(제강·연주·열연)별 불합격률을 서버가 계산해 준다. 기간은 판정 시각 기준 오늘 포함 최근 days일(기본 30일, 대시보드 강종별 불합격률과 같은 기준). "불합격률", "강종별 품질", "어느 강종이 불합격이 많아" 같은 질문에 쓴다.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'integer', description: `오늘 포함 최근 며칠 (1~${REJECT_RATE_MAX_DAYS}, 기본 ${REJECT_RATE_DEFAULT_DAYS})` },
          steelGradeCode: { type: 'string', description: '강종 코드 (예: SS275). 없으면 전 강종' },
        },
      },
    },
    async run(args) {
      const days = optionalPositiveInt(args, 'days') ?? REJECT_RATE_DEFAULT_DAYS;
      if (days > REJECT_RATE_MAX_DAYS) throw new ToolArgumentError(`days는 ${REJECT_RATE_MAX_DAYS} 이하예요`);
      const grade = optionalString(args, 'steelGradeCode', 30)?.toUpperCase();
      const now = new Date();
      const to = seoulToday(now);
      const from = seoulToday(new Date(now.getTime() - (days - 1) * DAY_MS));

      // 판정 시각 최신순이라 기간 시작일보다 앞선 판정이 나오면 멈춘다
      const judged: QualityInspectionListItem[] = [];
      let truncated = false;
      for (let page = 1; ; page++) {
        if (page > REJECT_RATE_MAX_PAGES) {
          truncated = true;
          break;
        }
        const result = await quality.listQualityInspections({ status: QUALITY_INSPECTION_LIST_STATUS.DONE, page, size: REJECT_RATE_PAGE_SIZE });
        for (const row of result.items) {
          const date = row.inspectedAt ? seoulToday(new Date(row.inspectedAt)) : null;
          if (date && date >= from && date <= to && (row.inspectionResult === 'PASS' || row.inspectionResult === 'FAIL')) judged.push(row);
        }
        const last = result.items.at(-1);
        const lastDate = last?.inspectedAt ? seoulToday(new Date(last.inspectedAt)) : null;
        if (page * REJECT_RATE_PAGE_SIZE >= result.total || result.items.length === 0 || (lastDate !== null && lastDate < from)) break;
      }

      const rows = grade ? judged.filter((r) => r.steelGradeCode?.toUpperCase() === grade) : judged;
      const byGrade = new Map<string, QualityInspectionListItem[]>();
      for (const row of rows) {
        const key = row.steelGradeCode ?? '(강종 없음)';
        byGrade.set(key, [...(byGrade.get(key) ?? []), row]);
      }
      const grades = [...byGrade.entries()]
        .map(([code, ofGrade]) => ({ code, ofGrade, ratio: failRatio(ofGrade) }))
        .sort((a, b) => b.ratio - a.ratio || a.code.localeCompare(b.code))
        .map(({ code, ofGrade }) => ({
          강종: code,
          ...rateCell(ofGrade),
          공정별: [...new Set(ofGrade.map((r) => r.processType))].map((processType) => ({ 공정: PROCESS_TYPE_LABEL[processType], ...rateCell(ofGrade.filter((r) => r.processType === processType)) })),
        }));
      return {
        label: `강종별 불합격률 · 최근 ${days}일${grade ? ` · ${grade}` : ''}`,
        data: {
          기간: `${from} ~ ${to} (판정 시각 기준, ${days}일)`,
          전체: rateCell(rows),
          강종별: grades,
          ...(rows.length === 0 ? { 안내: grade ? `기간 안에 ${grade} 판정이 없어요` : '기간 안에 판정한 검사가 없어요' } : {}),
          ...(truncated ? { 안내: `판정이 많아 최신 ${REJECT_RATE_MAX_PAGES * REJECT_RATE_PAGE_SIZE}건까지만 셌어요. 기간(days)을 줄여 다시 조회하세요` } : {}),
        },
      };
    },
  };
}

function failRatio(rows: readonly QualityInspectionListItem[]): number {
  return rows.length === 0 ? 0 : rows.filter((r) => r.inspectionResult === 'FAIL').length / rows.length;
}

/** 판정 수·불합격 수·불합격률(소수 1자리 %, 대시보드 위젯과 같은 자릿수) */
function rateCell(rows: readonly QualityInspectionListItem[]) {
  const failed = rows.filter((r) => r.inspectionResult === 'FAIL').length;
  return { '판정 수': rows.length, '불합격 수': failed, 불합격률: rows.length === 0 ? null : `${((failed / rows.length) * 100).toFixed(1)}%` };
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
