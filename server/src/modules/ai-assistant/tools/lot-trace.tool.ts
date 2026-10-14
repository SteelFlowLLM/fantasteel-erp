import { INSPECTION_RESULT_LABEL, LOT_STATUS_LABEL, LOT_TYPE_LABEL, TRACE_DIRECTION, type LotSummary, type TraceDirection } from '@fantasteel/shared';
import type { LotService } from '../../lot/lot.service';
import { limitRows, OPEN_ACCESS, optionalEnum, requiredString, ToolArgumentError, type AssistantTool } from './assistant-tool';

/** 추적 결과에서 넘기는 LOT 수 (코일 하나의 역추적은 보통 이보다 적다) */
const NODE_LIMIT = 30;
const CANDIDATE_LIMIT = 5;
const DIRECTIONS = Object.values(TRACE_DIRECTION) as TraceDirection[];

/** LOT 정·역추적 (GET /lots·/lots/:id/trace, 로그인한 전 역할) */
export function lotTraceTool(lots: LotService): AssistantTool {
  return {
    access: OPEN_ACCESS,
    definition: {
      name: 'trace_lot',
      description:
        'LOT 번호로 LOT 관계를 추적한다. backward(역추적)는 코일→슬래브→히트→용선→원료 방향, forward(정추적)는 아래 공정과 출하·수주 영향 범위. 방향을 안 주면 LOT 유형에 맞춘다. 검사 판정·상태도 함께 준다.',
      parameters: {
        type: 'object',
        properties: {
          lotNo: { type: 'string', description: 'LOT 번호 또는 앞부분 (예: HT-BOF1-260929-015)' },
          direction: { type: 'string', enum: DIRECTIONS, description: 'backward=역추적, forward=정추적' },
        },
        required: ['lotNo'],
      },
    },
    async run(args) {
      const lotNo = requiredString(args, 'lotNo');
      const direction = optionalEnum(args, 'direction', DIRECTIONS);
      const found = await lots.list({ lotNo, page: 1, size: CANDIDATE_LIMIT });
      const start = found.items.find((lot) => lot.lotNo.toLowerCase() === lotNo.toLowerCase()) ?? (found.total === 1 ? found.items[0] : undefined);
      if (!start) {
        if (found.total === 0) throw new ToolArgumentError(`${lotNo}로 시작하는 LOT이 없어요`);
        return { label: `LOT 검색 · ${lotNo}`, data: { 안내: '여러 LOT이 맞아요. 하나를 골라 다시 조회하세요', 후보: found.items.map((lot) => lot.lotNo), '후보 수': found.total } };
      }

      const trace = await lots.trace(start.id, direction);
      const nodes = limitRows(trace.nodes, NODE_LIMIT);
      return {
        label: `LOT ${trace.direction === TRACE_DIRECTION.BACKWARD ? '역추적' : '정추적'} · ${start.lotNo}`,
        data: {
          방향: trace.direction === TRACE_DIRECTION.BACKWARD ? '역추적' : '정추적',
          '시작 LOT': lotRow(trace.start),
          'LOT 관계': nodes.rows.map((node) => ({ 단계: node.depth, ...lotRow(node) })),
          '생략 LOT 수': nodes.omitted,
          ...(trace.impact
            ? {
                '영향 범위': {
                  슬래브: trace.impact.slabCount,
                  코일: trace.impact.coilCount,
                  '출고된 LOT': trace.impact.shippedLotCount,
                  '재고 LOT': trace.impact.unshippedLotCount,
                  '소진된 슬래브': trace.impact.consumedLotCount,
                  수주: trace.impact.salesOrders.map((s) => ({ 수주번호: s.salesOrderNo, 고객사: s.customerName, '출고됨': s.hasShipped, 'LOT 수': s.lotCount, 납기: s.dueDate })),
                },
              }
            : {}),
        },
      };
    },
  };
}

function lotRow(lot: LotSummary) {
  return {
    'LOT 번호': lot.lotNo,
    유형: LOT_TYPE_LABEL[lot.lotType],
    상태: LOT_STATUS_LABEL[lot.lotStatus],
    규격: lot.itemCode,
    강종: lot.steelGradeCode,
    '검사 판정': lot.inspectionResult ? INSPECTION_RESULT_LABEL[lot.inspectionResult] : null,
    생산완료일: lot.producedDate,
  };
}
