import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { PERMISSION_LABEL, ROLE_LABEL, type AiAssistantSource, type AuthUser, type Permission } from '@fantasteel/shared';
import { hasPermission } from '../../../common/auth/auth.guard';
import { AppException } from '../../../common/errors/app.exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiResearchService } from '../../ai-research/ai-research.service';
import { BusinessEventService } from '../../business-event/business-event.service';
import { DashboardService } from '../../dashboard/dashboard.service';
import { FactoryAgentService } from '../../factory-agent/factory-agent.service';
import { InventoryService } from '../../inventory/inventory.service';
import type { LlmToolCall, LlmToolDefinition } from '../../llm/llm.client';
import { LotService } from '../../lot/lot.service';
import { MasterDataService } from '../../master-data/master-data.service';
import { MeetingMinutesService } from '../../meeting-minutes/meeting-minutes.service';
import { MessageActionService } from '../../message-action/message-action.service';
import { MrpService } from '../../mrp/mrp.service';
import { PastCaseService } from '../../past-case/past-case.service';
import { ProductionResultService } from '../../production/production-result.service';
import { ProductionService } from '../../production/production.service';
import { PurchasingService } from '../../purchasing/purchasing.service';
import { QualityService } from '../../quality/quality.service';
import { RejectedLotService } from '../../quality/rejected-lot.service';
import { SalesOrderService } from '../../sales-order/sales-order.service';
import { ShipmentService } from '../../shipment/shipment.service';
import type { ProposedAnyCard } from '../action-card.types';
import { AiActionCardService } from '../ai-action-card.service';
import { AiOpsCardService } from '../ai-ops-card.service';
import { AiUpdateCardService } from '../ai-update-card.service';
import { ScheduleEventService } from '../../schedule-event/schedule-event.service';
import { NotificationService } from '../../notification/notification.service';
import { TaskService } from '../../notification/task.service';
import { AiAssistantRepository } from '../ai-assistant.repository';
import { ACTION_CARD_TOOLS, actionCardTools } from './action-card.tool';
import { myActionDraftsTool } from './action-draft.tool';
import { agentRiskTool } from './agent.tool';
import { myApprovalsTool } from './approval.tool';
import { ToolArgumentError, type AssistantTool } from './assistant-tool';
import { myBriefingTool } from './briefing.tool';
import { businessEventTool } from './business-event.tool';
import { dashboardTool } from './dashboard.tool';
import { inventoryTool } from './inventory.tool';
import { knowledgeTool } from './knowledge.tool';
import { myScheduleTool, myTasksTool } from './my-work.tool';
import { lotTraceTool } from './lot-trace.tool';
import { masterDataTool } from './master-data.tool';
import { meetingMinutesTool } from './meeting-minutes.tool';
import { mrpTool } from './mrp.tool';
import { myNotificationsTool } from './notification.tool';
import { productionPlanTool, productionResultTool } from './production.tool';
import { goodsReceiptTool, purchaseOrderTool, purchaseRequisitionTool } from './purchasing.tool';
import { qualityInspectionTool, qualityRejectRateTool, rejectedLotTool } from './quality.tool';
import { myResearchTool } from './research.tool';
import { salesOrderTool } from './sales-order.tool';
import { pastCaseTool } from './past-case.tool';
import { millSheetTool, shipmentRequestTool } from './shipment.tool';

/** 모델에 넘기는 도구 결과 길이 상한. 넘치면 자르고 잘렸다고 알린다 */
export const MAX_TOOL_RESULT_LENGTH = 8000;

export interface ToolRunResult {
  /** 모델에 tool 메시지로 넘길 JSON */
  content: string;
  /** 조회에 성공했을 때만 출처로 남긴다 */
  source: AiAssistantSource | null;
  /** 실행 카드를 만든 도구만 담는다 (키는 부르는 쪽이 붙인다) */
  cards?: ProposedAnyCard[];
}

/**
 * 도구가 감싸는 조회 service (REQ-AST-004 조회 대상: 재고, 수주 진행, 생산계획·실적, LOT 역추적, 검사 결과, 구매·입고, 출하·밀시트, 작업 로그 + REQ-AST-006 과거 사례).
 * 대시보드·MRP는 같은 대상을 묶은 숫자(불합격률·수율·출하 실적·원료 소요)라 모델이 직접 계산하지 않게(프롬프트 규칙 4) 따로 둔다
 */
export interface AssistantToolServices {
  pastCases: PastCaseService;
  dashboard: DashboardService;
  mrp: MrpService;
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
  actionCards: AiActionCardService;
  opsCards: AiOpsCardService;
  updateCards: AiUpdateCardService;
  scheduleEvents: ScheduleEventService;
  tasks: TaskService;
  // 이슈 #506: 알림·Agent·결재함·초안·기준정보·회의 검색·심층 조사 조회와 아침 브리핑
  notifications: NotificationService;
  agent: FactoryAgentService;
  messageActions: MessageActionService;
  masterData: MasterDataService;
  meetingMinutes: MeetingMinutesService;
  research: AiResearchService;
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
    qualityRejectRateTool(s.quality),
    purchaseRequisitionTool(s.purchasing),
    purchaseOrderTool(s.purchasing),
    goodsReceiptTool(s.purchasing),
    mrpTool(s.mrp),
    shipmentRequestTool(s.shipments),
    millSheetTool(s.shipments),
    dashboardTool(s.dashboard),
    businessEventTool(s.events, s.salesOrders, s.lots),
    pastCaseTool(s.pastCases),
    knowledgeTool(),
    myScheduleTool(s.scheduleEvents),
    myTasksTool(s.tasks),
    myNotificationsTool(s.notifications),
    myApprovalsTool(s.purchasing),
    myActionDraftsTool(s.messageActions),
    agentRiskTool(s.agent, s.notifications),
    myResearchTool(s.research),
    masterDataTool(s.masterData),
    meetingMinutesTool(s.meetingMinutes),
    myBriefingTool({ scheduleEvents: s.scheduleEvents, tasks: s.tasks, purchasing: s.purchasing, notifications: s.notifications, agent: s.agent, salesOrders: s.salesOrders }),
    ...actionCardTools(s.actionCards, s.opsCards, s.updateCards),
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
    pastCases: PastCaseService,
    actionCards: AiActionCardService,
    opsCards: AiOpsCardService,
    dashboard: DashboardService,
    mrp: MrpService,
    updateCards: AiUpdateCardService,
    scheduleEvents: ScheduleEventService,
    tasks: TaskService,
    notifications: NotificationService,
    agent: FactoryAgentService,
    messageActions: MessageActionService,
    masterData: MasterDataService,
    meetingMinutes: MeetingMinutesService,
    // 심층 조사 모듈과 서로 부르는 사이라 forwardRef (AiResearchCardService와 같다)
    @Inject(forwardRef(() => AiResearchService)) research: AiResearchService,
  ) {
    const tools = assistantTools({ inventory, salesOrders, lots, events, plans, results, quality, rejectedLots, purchasing, shipments, pastCases, actionCards, opsCards, dashboard, mrp, updateCards, scheduleEvents, tasks, notifications, agent, messageActions, masterData, meetingMinutes, research });
    this.tools = new Map(tools.map((tool) => [tool.definition.name, tool]));
  }

  /**
   * 모두에게 같은 도구 목록을 준다. 권한은 실행할 때 확인해서, 권한 밖이면 담당 역할을 안내하게 한다.
   * 실행 카드 도구와 내 일정·업무 조회(panelOnly)는 카드를 보여 줄 수 있는 화면(철강맨AI 패널)이 요청했을 때만 넣는다.
   */
  definitions(options: { actionCards?: boolean } = {}): LlmToolDefinition[] {
    return [...this.tools.values()].filter((tool) => options.actionCards || (!ACTION_CARD_TOOLS.includes(tool.definition.name) && !tool.panelOnly)).map((tool) => tool.definition);
  }

  /**
   * 이 사용자가 이 도구들이 보여 주는 데이터를 모두 볼 수 있는지 (채팅에 남은 AI 답을 멤버마다 보일지 정할 때).
   * 이름은 답의 조회 출처 id다: 위젯처럼 범위가 있는 도구는 `get_dashboard_summary:process_yield`로 남아, 그 범위의 권한(없으면 전 역할)으로 본다.
   * 범위가 없는 옛 출처(`get_dashboard_summary`)는 모든 범위를 볼 수 있어야 한다.
   * 필요 권한 중 하나라도 VIEW 이상이면 된다. service가 따로 확인하는 조건(예: 구매요청의 부서장)은 여기서 알 수 없어
   * 권한만 본다 — 못 보는 쪽으로 기운다. 모르는 도구는 볼 수 없다고 본다.
   */
  canViewAll(user: AuthUser, toolNames: readonly string[]): boolean {
    const visible = (permissions: readonly Permission[]) => permissions.length === 0 || permissions.some((permission) => hasPermission(user, { permission, level: 'VIEW' }));
    return toolNames.every((sourceId) => {
      const { name, scope } = splitSourceId(sourceId);
      const tool = this.tools.get(name);
      // 사원 본인의 것은 다른 멤버에게 보이지 않는다
      if (!tool || tool.panelOnly) return false;
      const scoped = tool.access.scoped;
      if (!scoped) return visible(tool.access.permissions);
      if (scope === undefined) return Object.values(scoped.permissions).every(visible);
      return Object.hasOwn(scoped.permissions, scope) && visible(scoped.permissions[scope]);
    });
  }

  async run(user: AuthUser, call: LlmToolCall): Promise<ToolRunResult> {
    const tool = this.tools.get(call.name);
    if (!tool) return failure(`없는 도구예요: ${call.name}`);

    let args: unknown;
    try {
      args = JSON.parse(call.arguments || '{}');
    } catch {
      return failure('인자가 JSON이 아니에요');
    }
    if (typeof args !== 'object' || args === null || Array.isArray(args)) return failure('인자는 객체여야 해요');

    // 범위(위젯)마다 화면 권한이 다른 도구는 그 범위의 권한으로 본다. 모르는 범위는 권한을 따지지 않고 도구가 인자 오류로 돌려준다
    const scope = scopeOf(tool, args as Record<string, unknown>);
    const required = scope === undefined ? tool.access.permissions : (tool.access.scoped?.permissions[scope] ?? []);
    const unknownScope = tool.access.scoped !== undefined && scope === undefined;
    if (tool.access.checkedBy === 'TOOLBOX' && !unknownScope && required.length && !required.some((permission) => hasPermission(user, { permission, level: 'VIEW' }))) {
      return this.denied(user, tool, required);
    }

    try {
      const output = await tool.run(args as Record<string, unknown>, user);
      return { content: truncate(JSON.stringify(output.data)), source: output.cards || output.hideSource ? null : { kind: 'DATA', id: scope ? `${call.name}:${scope}` : call.name, label: output.label }, cards: output.cards };
    } catch (error) {
      if (error instanceof ToolArgumentError) return failure(error.message);
      // service가 사용자로 확인하는 도구는 권한 밖이면 COM-002를 던진다
      if (error instanceof AppException && error.code === 'COM-002') return this.denied(user, tool, required);
      if (error instanceof AppException) return failure(messageOf(error));
      this.logger.error(`AI 어시스턴트 도구 실패 (${call.name})`, error instanceof Error ? error.stack : String(error));
      return failure('조회 중 서버 오류가 났어요');
    }
  }

  private async denied(user: AuthUser, tool: AssistantTool, permissions: readonly Permission[]): Promise<ToolRunResult> {
    const note = tool.access.note;
    const roles = await this.repository.findRoleCodesWithAnyPermission(this.prisma, permissions);
    const names = permissions.map((permission) => `'${PERMISSION_LABEL[permission]}'`).join(' 또는 ');
    return failure('권한 없음', {
      안내: `이 데이터는 ${names} 조회 권한이 필요해요. 사용자 역할(${ROLE_LABEL[user.roleCode]})에는 없어요.${note ? ` ${note}` : ''}`,
      '조회할 수 있는 역할': roles.map((role) => ROLE_LABEL[role]),
    });
  }
}

/** 조회 출처 id `get_dashboard_summary:process_yield` → 도구 이름과 범위 */
function splitSourceId(sourceId: string): { name: string; scope?: string } {
  const at = sourceId.indexOf(':');
  return at < 0 ? { name: sourceId } : { name: sourceId.slice(0, at), scope: sourceId.slice(at + 1) };
}

/** 이 호출의 범위(위젯). 범위 인자가 없거나 모르는 값이면 undefined */
function scopeOf(tool: AssistantTool, args: Record<string, unknown>): string | undefined {
  const scoped = tool.access.scoped;
  if (!scoped) return undefined;
  const value = args[scoped.argument];
  return typeof value === 'string' && Object.hasOwn(scoped.permissions, value) ? value : undefined;
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
