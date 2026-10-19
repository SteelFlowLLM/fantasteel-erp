import { PERMISSION, RAW_MATERIAL_TYPE_LABEL } from '@fantasteel/shared';
import { seoulToday } from '../../../common/time/seoul-date';
import type { MrpService } from '../../mrp/mrp.service';
import { limitRows, optionalDate, ToolArgumentError, type AssistantTool } from './assistant-tool';

/** 기간을 말하지 않은 질문: 오늘부터 30일 (Factory Agent 원료 부족 규칙과 같은 기간, RAW_SHORTAGE_HORIZON_DAYS) */
export const MRP_DEFAULT_DAYS = 30;
const DAY_MS = 86_400_000;

/** MRP 원료 소요 (GET mrp/requirements, API-206, 구매요청 등록·MRP VIEW). MRP 화면과 같은 계산 결과를 그대로 넘긴다(저장 없음) */
export function mrpTool(mrp: MrpService): AssistantTool {
  return {
    access: { checkedBy: 'TOOLBOX', permissions: [PERMISSION.PURCHASE_REQUISITION_CREATE] },
    definition: {
      name: 'get_mrp_requirements',
      description: `MRP로 원료별 소요 톤·잔량 톤·입고예정 톤·순소요(부족) 톤과 처음 부족한 필요일, 구매요청으로 이어질 줄을 조회한다. 필요일이 to 이하인 생산계획을 본다. 기간을 말하지 않으면 오늘부터 ${MRP_DEFAULT_DAYS}일. "원료 부족해?", "MRP 결과", "순소요" 같은 질문에 쓴다.`,
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '시작일 YYYY-MM-DD (기본 오늘)' },
          to: { type: 'string', description: `종료일 YYYY-MM-DD (기본 오늘 + ${MRP_DEFAULT_DAYS}일)` },
        },
      },
    },
    async run(args) {
      const today = seoulToday();
      const from = optionalDate(args, 'from') ?? today;
      const to = optionalDate(args, 'to') ?? seoulToday(new Date(Date.parse(`${from}T00:00:00+09:00`) + MRP_DEFAULT_DAYS * DAY_MS));
      if (to < from) throw new ToolArgumentError('to는 from과 같거나 뒤여야 해요');
      const view = await mrp.requirements({ from, to });
      const lines = limitRows(view.requisitionLines);
      return {
        label: `MRP 원료 소요 · ${from} ~ ${to}`,
        data: {
          기간: `${from} ~ ${to} (필요일 기준)`,
          '보이는 생산계획 수': view.plans.length,
          '밀린 소요 생산계획 수': view.plans.filter((p) => p.isBeforePeriod).length,
          '히트 1회 용강 톤': view.heatCapacityTon,
          원료: view.materials.map((m) => ({
            '원료 코드': m.itemCode,
            원료명: m.itemName,
            '원료 유형': m.rawMaterialType ? RAW_MATERIAL_TYPE_LABEL[m.rawMaterialType] : null,
            '소요 톤': m.requiredTon,
            '잔량 톤': m.remainingTon,
            '입고예정 톤': m.scheduledReceiptTon,
            '순소요 톤': m.netRequirementTon,
            '처음 부족한 필요일': m.firstShortageDate,
          })),
          '순소요가 있는 원료 수': view.materials.filter((m) => Number(m.netRequirementTon) > 0).length,
          '구매요청으로 이어질 줄': lines.rows.map((l) => ({
            '생산계획 번호': l.productionPlanNo,
            '원료 코드': l.itemCode,
            원료명: l.itemName,
            '순소요 톤': l.netRequirementTon,
            필요일: l.requiredDate,
            '이미 있는 구매요청': l.existingPurchaseRequisitionNo,
          })),
          '생략 줄 수': lines.omitted,
        },
      };
    },
  };
}
