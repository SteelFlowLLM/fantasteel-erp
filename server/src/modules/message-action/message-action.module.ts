import { Module } from '@nestjs/common';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { ACTION_DEFINITIONS, type ActionDefinition } from './action-definition';
import { ActionDraftController } from './action-draft.controller';
import { ActionDraftRepository } from './action-draft.repository';
import { ActionDraftService } from './action-draft.service';
import { ActionRegistry } from './action-registry';
import { PurchaseRequisitionCreateDefinition } from './definitions/purchase-requisition-create.definition';

// Message → ERP (REQ-ACT-001~004). 업무 유형을 추가할 때는 정의 클래스를 providers와 ACTION_DEFINITIONS의 inject에 넣는다.
@Module({
  imports: [PurchasingModule],
  controllers: [ActionDraftController],
  providers: [
    PurchaseRequisitionCreateDefinition,
    {
      provide: ACTION_DEFINITIONS,
      useFactory: (...definitions: ActionDefinition[]) => definitions,
      inject: [PurchaseRequisitionCreateDefinition],
    },
    ActionRegistry,
    ActionDraftRepository,
    ActionDraftService,
  ],
})
export class MessageActionModule {}
