// 업무 유형 등록부 (REQ-ACT-004). 메시지에서 만들 수 있는 유형만 넣는다 (업무 프로세스 12.3 Message → ERP 유형 표).
// 유형을 더하면 정의를 이 생성자에 넣고 message-action.module.ts providers에 등록한다.
import { Injectable } from '@nestjs/common';
import { AppException } from '../../../common/errors/app.exception';
import type { ActionDefinition } from './action-definition';
import { AllocationAction } from './allocation.action';
import { PurchaseRequisitionAction } from './purchase-requisition.action';
import { ReproductionPlanAction } from './reproduction-plan.action';
import { SalesOrderAction } from './sales-order.action';
import { ShipmentRequestAction } from './shipment-request.action';

@Injectable()
export class ActionTypeRegistry {
  private readonly definitions: ReadonlyMap<string, ActionDefinition>;

  constructor(purchaseRequisition: PurchaseRequisitionAction, salesOrder: SalesOrderAction, shipmentRequest: ShipmentRequestAction, allocation: AllocationAction, reproductionPlan: ReproductionPlanAction) {
    // 생산계획 생성은 메시지에서 만들지 않는다 (일반 계획은 수주 등록 때 자동 생성, BP-ACT-02)
    const definitions: ActionDefinition[] = [purchaseRequisition, salesOrder, shipmentRequest, allocation, reproductionPlan];
    this.definitions = new Map(definitions.map((d) => [d.actionType, d]));
  }

  /** 등록된 유형의 정의. 없으면 COM-004 (아직 메시지에서 만들 수 없는 유형) */
  get(actionType: string): ActionDefinition {
    const definition = this.definitions.get(actionType);
    if (!definition) throw new AppException('COM-004', '메시지에서 아직 만들 수 없는 업무 유형이에요');
    return definition;
  }
}
