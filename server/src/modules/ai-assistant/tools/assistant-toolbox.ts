import { Injectable, Logger } from '@nestjs/common';
import { PERMISSION_LABEL, ROLE_LABEL, type AiAssistantSource, type AuthUser } from '@fantasteel/shared';
import { hasPermission } from '../../../common/auth/auth.guard';
import { AppException } from '../../../common/errors/app.exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { BusinessEventService } from '../../business-event/business-event.service';
import { InventoryService } from '../../inventory/inventory.service';
import type { LlmToolCall, LlmToolDefinition } from '../../llm/llm.client';
import { LotService } from '../../lot/lot.service';
import { ProductionResultService } from '../../production/production-result.service';
import { ProductionService } from '../../production/production.service';
import { PurchasingService } from '../../purchasing/purchasing.service';
import { QualityService } from '../../quality/quality.service';
import { RejectedLotService } from '../../quality/rejected-lot.service';
import { SalesOrderService } from '../../sales-order/sales-order.service';
import { ShipmentService } from '../../shipment/shipment.service';
import { AiAssistantRepository } from '../ai-assistant.repository';
import { ToolArgumentError, type AssistantTool } from './assistant-tool';
import { businessEventTool } from './business-event.tool';
import { inventoryTool } from './inventory.tool';
import { lotTraceTool } from './lot-trace.tool';
import { productionPlanTool, productionResultTool } from './production.tool';
import { goodsReceiptTool, purchaseOrderTool, purchaseRequisitionTool } from './purchasing.tool';
import { qualityInspectionTool, rejectedLotTool } from './quality.tool';
import { salesOrderTool } from './sales-order.tool';
import { millSheetTool, shipmentRequestTool } from './shipment.tool';

/** 모델에 넘기는 도구 결과 길이 상한. 넘치면 자르고 잘렸다고 알린다 */
export const MAX_TOOL_RESULT_LENGTH = 8000;

export interface ToolRunResult {
  /** 모델에 tool 메시지로 넘길 JSON */
  content: string;
  /** 조회에 성공했을 때만 출처로 남긴다 */
  source: AiAssistantSource | null;
}

/** 도구가 감싸는 조회 service (REQ-AST-004 조회 대상: 재고, 수주 진행, 생산계획·실적, LOT 역추적, 검사 결과, 구매·입고, 출하·밀시트, 작업 로그) */
export interface AssistantToolServices {
  inventory: InventoryService;
  salesOrders: SalesOrderService;
  lots: LotService;
  events: BusinessEventService;
  plans: ProductionService;
  results: ProductionResultService;
  quality: QualityService;
  rejectedLots: RejectedLotService;
  purchasing: PurchasingService;
  shipments: ShipmentService;
}

export function assistantTools(s: AssistantToolServices): AssistantTool[] {
  return [
    inventoryTool(s.inventory),
    salesOrderTool(s.salesOrders),
    productionPlanTool(s.plans),
    productionResultTool(s.plans, s.results),
    lotTraceTool(s.lots),
    qualityInspectionTool(s.quality),
    rejectedLotTool(s.rejectedLots),
    purchaseRequisitionTool(s.purchasing),
    purchaseOrderTool(s.purchasing),
    goodsReceiptTool(s.purchasing),
    shipmentRequestTool(s.shipments),
    millSheetTool(s.shipments),
    businessEventTool(s.events, s.salesOrders, s.lots),
  ];
}

/**
 * 데이터 조회 도구 모음 (REQ-AST-004). 도구마다 같은 데이터를 보여 주는 API와 같은 권한을 사용자 기준으로 확인한다.
 * 실패(권한 없음·인자 오류·대상 없음)는 예외가 아니라 결과로 모델에 돌려줘서, 모델이 사용자에게 설명하게 한다.
 */
@Injectable()
export class AssistantToolbox {
  private readonly logger = new Logger(AssistantToolbox.name);
  private readonly tools: Map<string, AssistantTool>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AiAssistantRepository,
    inventory: InventoryService,
    salesOrders: SalesOrderService,
    lots: LotService,
    events: BusinessEventService,
    plans: ProductionService,
    results: ProductionResultService,
    quality: QualityService,
    rejectedLots: RejectedLotService,
    purchasing: PurchasingService,
    shipments: ShipmentService,
  ) {
    const tools = assistantTools({ inventory, salesOrders, lots, events, plans, results, quality, rejectedLots, purchasing, shipments });
    this.tools = new Map(tools.map((tool) => [tool.definition.name, tool]));
  }

  /** 모두에게 같은 도구 목록을 준다. 권한은 실행할 때 확인해서, 권한 밖이면 담당 역할을 안내하게 한다 */
  definitions(): LlmToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  async run(user: AuthUser, call: LlmToolCall): Promise<ToolRunResult> {
    const tool = this.tools.get(call.name);
    if (!tool) return failure(`없는 도구예요: ${call.name}`);

    const { access } = tool;
    if (access.checkedBy === 'TOOLBOX' && access.permissions.length && !access.permissions.some((permission) => hasPermission(user, { permission, level: 'VIEW' }))) {
      return this.denied(user, tool);
    }

    let args: unknown;
    try {
      args = JSON.parse(call.arguments || '{}');
    } catch {
      return failure('인자가 JSON이 아니에요');
    }
    if (typeof args !== 'object' || args === null || Array.isArray(args)) return failure('인자는 객체여야 해요');

    try {
      const output = await tool.run(args as Record<string, unknown>, user);
      return { content: truncate(JSON.stringify(output.data)), source: { kind: 'DATA', id: call.name, label: output.label } };
    } catch (error) {
      if (error instanceof ToolArgumentError) return failure(error.message);
      // service가 사용자로 확인하는 도구는 권한 밖이면 COM-002를 던진다
      if (error instanceof AppException && error.code === 'COM-002') return this.denied(user, tool);
      if (error instanceof AppException) return failure(messageOf(error));
      this.logger.error(`AI 어시스턴트 도구 실패 (${call.name})`, error instanceof Error ? error.stack : String(error));
      return failure('조회 중 서버 오류가 났어요');
    }
  }

  private async denied(user: AuthUser, tool: AssistantTool): Promise<ToolRunResult> {
    const { permissions, note } = tool.access;
    const roles = await this.repository.findRoleCodesWithAnyPermission(this.prisma, permissions);
    const names = permissions.map((permission) => `'${PERMISSION_LABEL[permission]}'`).join(' 또는 ');
    return failure('권한 없음', {
      안내: `이 데이터는 ${names} 조회 권한이 필요해요. 사용자 역할(${ROLE_LABEL[user.roleCode]})에는 없어요.${note ? ` ${note}` : ''}`,
      '조회할 수 있는 역할': roles.map((role) => ROLE_LABEL[role]),
    });
  }
}

function failure(reason: string, extra: Record<string, unknown> = {}): ToolRunResult {
  return { content: JSON.stringify({ 오류: reason, ...extra }), source: null };
}

function messageOf(error: AppException): string {
  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'message' in response ? String(response.message) : error.message;
}

function truncate(json: string): string {
  return json.length <= MAX_TOOL_RESULT_LENGTH ? json : `${json.slice(0, MAX_TOOL_RESULT_LENGTH)}… (결과가 길어 잘렸어요. 조건을 좁혀 다시 조회하세요)`;
}
