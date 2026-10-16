import { Injectable } from '@nestjs/common';
import { isAiAssistantWriteTool } from '@fantasteel/shared';
import { BusinessEventRecorder } from '../../../common/business-event/business-event.recorder';
import { PrismaService } from '../../../prisma/prisma.service';
import type { LlmToolDefinition } from '../../llm/llm.client';
import { MessageActionService } from '../../message-action/message-action.service';
import { ScheduleEventService } from '../../schedule-event/schedule-event.service';
import type { AssistantWriteTool } from './assistant-write-tool';
import { purchaseRequisitionDraftWriteTool } from './purchase-requisition-draft.write-tool';
import { scheduleEventWriteTool } from './schedule-event.write-tool';

/** 쓰기 도구 모음 (승인 카드, 이슈 #362). 도구 이름은 shared의 AI_ASSISTANT_WRITE_TOOLS와 같아야 한다 */
@Injectable()
export class AssistantWriteToolbox {
  private readonly tools: Map<string, AssistantWriteTool>;

  constructor(prisma: PrismaService, recorder: BusinessEventRecorder, scheduleEvents: ScheduleEventService, messageActions: MessageActionService) {
    const tools = [scheduleEventWriteTool({ prisma, recorder, scheduleEvents }), purchaseRequisitionDraftWriteTool({ prisma, messageActions })];
    this.tools = new Map(tools.map((tool) => [tool.definition.name, tool]));
  }

  definitions(): LlmToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  get(name: string): AssistantWriteTool | undefined {
    return isAiAssistantWriteTool(name) ? this.tools.get(name) : undefined;
  }
}
