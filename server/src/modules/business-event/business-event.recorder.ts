import { Injectable } from '@nestjs/common';
import type { ActorType, AuthUser, BusinessEventType, EventReasonCode, EventTargetType } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { serialize } from '../../common/http/response.interceptor';

export interface RecordEventInput {
  /** 로그인 사원이 한 일이면 넘긴다. 없으면 SYSTEM (자동 예약·자동 판정·시뮬레이션). */
  actor?: AuthUser | null;
  eventType: BusinessEventType;
  targetType: EventTargetType;
  targetId?: number | null;
  /** 수주번호·LOT번호 등 화면 표시용 번호 */
  targetNo?: string | null;
  /** 수주 타임라인에 보이게 하려면 넣는다 */
  salesOrderId?: number | null;
  /** LOT 타임라인에 보이게 하려면 넣는다 */
  lotIds?: number[];
  /** 사람이 읽는 한 줄 (해요체 아님, 사실 서술). 예: "합격 재고 6매 예약" */
  summary: string;
  before?: unknown;
  after?: unknown;
  reasonCode?: EventReasonCode | null;
  reason?: string | null;
  isAiAssisted?: boolean;
  messageId?: number | null;
  actionDraftId?: number | null;
}

/**
 * 작업 로그 기록기 (REQ-LOG-001·002). 본 거래와 같은 트랜잭션(tx)에서 호출한다.
 * 비밀번호·토큰은 before/after에 넣지 않는다.
 */
@Injectable()
export class BusinessEventRecorder {
  constructor(private readonly realtime: RealtimeService) {}

  async record(tx: Tx, input: RecordEventInput): Promise<void> {
    const actorType: ActorType = input.actor ? 'USER' : 'SYSTEM';
    await tx.businessEvent.create({
      data: {
        actorType,
        actorEmployeeId: input.actor?.employeeId ?? null,
        eventType: input.eventType,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        targetNo: input.targetNo ?? null,
        salesOrderId: input.salesOrderId ?? null,
        lotIds: [...new Set(input.lotIds ?? [])],
        summary: input.summary,
        beforeData: toJson(input.before),
        afterData: toJson(input.after),
        reasonCode: input.reasonCode ?? null,
        reason: input.reason ?? null,
        isAiAssisted: input.isAiAssisted ?? false,
        messageId: input.messageId ?? null,
        actionDraftId: input.actionDraftId ?? null,
      },
    });
    this.realtime.changed('business-events');
  }
}

function toJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (v === undefined || v === null) return Prisma.DbNull;
  return serialize(v) as Prisma.InputJsonValue;
}
