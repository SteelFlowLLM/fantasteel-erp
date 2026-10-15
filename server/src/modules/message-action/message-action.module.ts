import { Module } from '@nestjs/common';
import { FactoryAgentModule } from '../factory-agent/factory-agent.module';
import { LlmModule } from '../llm/llm.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { ActionTypeRegistry } from './action-types/action-type.registry';
import { PurchaseRequisitionAction } from './action-types/purchase-requisition.action';
import { DraftExtractor } from './draft-extractor';
import { MessageActionController } from './message-action.controller';
import { MessageActionRepository } from './message-action.repository';
import { MessageActionService } from './message-action.service';

/** Message → ERP 초안 (REQ-ACT-001~005, BP-ACT-01·02). 업무 유형은 등록부(ActionTypeRegistry)에 둔다. 작업 안내: docs/backend/message-action.md */
@Module({
  // 초안 API는 Agent 대응 후보(REQ-AGT-005·006)도 같이 쓰므로 후보 요청을 factory-agent로 넘긴다
  imports: [PurchasingModule, FactoryAgentModule, LlmModule],
  controllers: [MessageActionController],
  providers: [MessageActionService, MessageActionRepository, ActionTypeRegistry, PurchaseRequisitionAction, DraftExtractor],
  // 회의록 확정이 같은 트랜잭션에서 구매요청 초안을 만든다
  exports: [MessageActionService],
})
export class MessageActionModule {}
