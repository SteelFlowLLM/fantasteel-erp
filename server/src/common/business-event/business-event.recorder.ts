import { Injectable } from '@nestjs/common';
import { ACTOR_TYPE, type AuthUser, type BusinessEventType } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';

export interface BusinessEventInput {
  type: BusinessEventType;
  /** 사람이 한 일이면 로그인 사원, 시스템(자동 예약·자동 판정 등)이면 'SYSTEM' */
  actor: AuthUser | 'SYSTEM';
  /** 대상 테이블명(ERD 이름)과 id. 예: { table: 'sales_order', id: 12 } */
  target: { table: string; id: number };
  /** 수주 타임라인에 보일 수주 (REQ-LOG-003) */
  salesOrderId?: number | null;
  /** LOT 타임라인에 보일 LOT들 (business_event_lot) */
  lotIds?: number[];
  /** 변경 전·후 데이터. 비밀번호 해시·토큰은 넣지 않는다 */
  before?: unknown;
  after?: unknown;
  /** 사유. 정의서 9.3 사유 코드(STOCK_FIRST 등)와 사람이 읽을 문장 */
  reason?: string | null;
  isAiAssisted?: boolean;
  actionDraftId?: number | null;
  messageId?: number | null;
}

const toJson = (value: unknown) =>
  value === undefined || value === null ? Prisma.DbNull : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);

/**
 * 작업 로그 기록 (REQ-LOG-001~002, 코드 컨벤션 6장). 본 거래와 같은 트랜잭션의 tx를 넘긴다.
 * 수정·삭제 함수는 두지 않는다.
 *   await this.businessEventRecorder.record(tx, { type: BUSINESS_EVENT_TYPE.SALES_ORDER_CREATED, actor: user, target: { table: 'sales_order', id }, salesOrderId: id });
 */
@Injectable()
export class BusinessEventRecorder {
  constructor(private readonly numbering: NumberingService) {}

  async record(tx: Tx, input: BusinessEventInput): Promise<{ id: number; businessEventNo: string }> {
    const businessEventNo = await this.numbering.nextDocumentNumber(tx, 'BUSINESS_EVENT');
    const isSystem = input.actor === 'SYSTEM';
    const event = await tx.businessEvent.create({
      data: {
        businessEventNo,
        businessEventType: input.type,
        actorType: isSystem ? ACTOR_TYPE.SYSTEM : ACTOR_TYPE.USER,
        actorEmployeeId: input.actor === 'SYSTEM' ? null : input.actor.employeeId,
        targetType: input.target.table,
        targetId: input.target.id,
        salesOrderId: input.salesOrderId ?? null,
        beforeData: toJson(input.before),
        afterData: toJson(input.after),
        reason: input.reason ?? null,
        isAiAssisted: input.isAiAssisted ?? false,
        actionDraftId: input.actionDraftId ?? null,
        messageId: input.messageId ?? null,
      },
      select: { id: true, businessEventNo: true },
    });
    const lotIds = [...new Set(input.lotIds ?? [])];
    if (lotIds.length) await tx.businessEventLot.createMany({ data: lotIds.map((lotId) => ({ businessEventId: event.id, lotId })) });
    return event;
  }
}
