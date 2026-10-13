import {
  PERMISSION,
  PROCESS_TYPE,
  PROCESS_TYPE_LABEL,
  PRODUCTION_PLAN_STATUS,
  PRODUCTION_PLAN_STATUS_LABEL,
  type ProcessType,
  type ProductionPlanStatus,
  type ProductionPlanSummary,
  type ProductionResultView,
} from '@fantasteel/shared';
import type { ProductionResultService } from '../../production/production-result.service';
import type { ProductionService } from '../../production/production.service';
import { limitRows, looseIncludes, optionalEnum, optionalString, seoulDateTimeText, ToolArgumentError, type AssistantTool } from './assistant-tool';

/** 번호로 거를 때 한 번에 읽는 계획 수 (API 상한 100) */
const SCAN_SIZE = 100;
const PLAN_STATUSES = Object.values(PRODUCTION_PLAN_STATUS) as ProductionPlanStatus[];
const PROCESS_TYPES = Object.values(PROCESS_TYPE) as ProcessType[];

/** 생산계획 (GET /production-plans, 생산계획 확정 VIEW) */
export function productionPlanTool(plans: ProductionService): AssistantTool {
  return {
    access: { checkedBy: 'TOOLBOX', permissions: [PERMISSION.PRODUCTION_PLAN_CONFIRM] },
    definition: {
      name: 'get_production_plans',
      description:
        '생산계획을 조회한다. 상태(PLANNED 시작 전, IN_PROGRESS 진행중, COMPLETED 완료, CANCELLED 취소), 생산계획 번호·수주번호 일부로 거른다. 히트 수, 제강·연주를 마친 히트 수, 합격 매수, 남은 목표 매수를 준다. "진행 중인 히트", "생산계획 현황"을 물으면 쓴다.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: PLAN_STATUSES, description: '계획 상태' },
          keyword: { type: 'string', description: '생산계획 번호·수주번호·규격 일부 (예: PP-2610-0001, SO-2610-001)' },
        },
      },
    },
    async run(args) {
      const status = optionalEnum(args, 'status', PLAN_STATUSES);
      const keyword = optionalString(args, 'keyword');
      const page = await plans.listPlans({ productionPlanStatus: status, page: 1, size: SCAN_SIZE });
      const rows = keyword ? page.items.filter((p) => looseIncludes([p.productionPlanNo, p.salesOrderNo, p.itemCode], keyword)) : page.items;
      const limited = limitRows(rows);
      return {
        label: `생산계획${status ? ` · ${PRODUCTION_PLAN_STATUS_LABEL[status]}` : ''}${keyword ? ` · ${keyword}` : ''}`,
        data: { '생산계획 수': rows.length, 생산계획: limited.rows.map(planRow), '생략 줄 수': limited.omitted, ...unscannedOf(page) },
      };
    },
  };
}

/** 작업 실적 (GET /production-results, 작업 실적 확정 VIEW). "공정 실적"은 용어 사전 금지어라 작업 실적으로 쓴다 */
export function productionResultTool(plans: ProductionService, results: ProductionResultService): AssistantTool {
  return {
    access: { checkedBy: 'TOOLBOX', permissions: [PERMISSION.PRODUCTION_RESULT_CONFIRM] },
    definition: {
      name: 'get_production_results',
      description: '작업 실적(공정별 작업 시작·완료, 투입 톤, 산출 매수·톤, 산출 LOT)을 최신순으로 조회한다. 생산계획 번호와 공정(제선·제강·연주·열연)으로 거른다.',
      parameters: {
        type: 'object',
        properties: {
          productionPlanNo: { type: 'string', description: '생산계획 번호 (정확히, 예: PP-2610-0001)' },
          processType: { type: 'string', enum: PROCESS_TYPES, description: 'IRONMAKING 제선, STEELMAKING 제강, CONTINUOUS_CASTING 연주, HOT_ROLLING 열연' },
        },
      },
    },
    async run(args) {
      const productionPlanNo = optionalString(args, 'productionPlanNo', 30);
      const processType = optionalEnum(args, 'processType', PROCESS_TYPES);
      const productionPlanId = productionPlanNo ? await planIdOf(plans, productionPlanNo) : undefined;
      const page = await results.listResults({ productionPlanId, processType, page: 1, size: 15 });
      return {
        label: `작업 실적${productionPlanNo ? ` · ${productionPlanNo}` : ''}${processType ? ` · ${PROCESS_TYPE_LABEL[processType]}` : ''}`,
        data: { '작업 실적 수': page.total, '최신 작업 실적': page.items.map(resultRow), '생략 건수': Math.max(0, page.total - page.items.length) },
      };
    },
  };
}

async function planIdOf(plans: ProductionService, productionPlanNo: string): Promise<number> {
  const page = await plans.listPlans({ page: 1, size: SCAN_SIZE });
  const found = page.items.find((p) => p.productionPlanNo.toLowerCase() === productionPlanNo.toLowerCase());
  if (!found) throw new ToolArgumentError(`생산계획 번호 ${productionPlanNo}가 없어요`);
  return found.id;
}

function unscannedOf(page: { total: number; items: unknown[] }) {
  const unscanned = Math.max(0, page.total - page.items.length);
  return unscanned ? { '확인하지 못한 생산계획 수': unscanned } : {};
}

function planRow(p: ProductionPlanSummary) {
  return {
    '생산계획 번호': p.productionPlanNo,
    상태: PRODUCTION_PLAN_STATUS_LABEL[p.productionPlanStatus],
    재생산: p.isReproduction,
    규격: p.itemCode,
    강종: p.steelGradeCode,
    수주번호: p.salesOrderNo,
    고객사: p.customerName,
    납기: p.dueDate,
    '부족 매수': p.shortageQty,
    '히트 수': p.heatCount,
    '제강 마친 히트 수': p.heatsMadeQty,
    '연주 마친 히트 수': p.heatsCastQty,
    '합격 매수': p.passedQty,
    '남은 목표 매수': p.remainingTargetQty,
  };
}

function resultRow(r: ProductionResultView) {
  return {
    공정: PROCESS_TYPE_LABEL[r.processType],
    '생산계획 번호': r.productionPlanNo,
    설비: r.blastFurnaceCode ?? r.converterCode,
    시작: seoulDateTimeText(r.startedAt),
    완료: r.completedAt ? seoulDateTimeText(r.completedAt) : null,
    '투입 톤': r.inputTon,
    '산출 매수': r.outputQty,
    '산출 톤': r.outputTon,
    작업자: r.operatorName,
    시뮬레이션: r.isSimulated,
    '산출 LOT': r.outputs.slice(0, 5).map((lot) => lot.lotNo),
    '산출 LOT 수': r.outputs.length,
  };
}
