import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { RealtimeService } from '../../common/realtime/realtime.service';
import type { Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';

export interface MasterChange {
  /** 기준정보 코드 (강종 코드, 규격 코드 등). 코드가 없는 대상은 대상 이름 */
  targetNo: string;
  targetId?: number | null;
  /** 사실 한 줄. 예: "제품 규격 SL-SS275-250x1200x10000 등록" */
  summary: string;
  before?: unknown;
  after?: unknown;
}

/** 기준정보 변경을 작업 로그(MASTER_CHANGED)에 남기고 화면 갱신 신호를 보낸다 (REQ-LOG-002). 변경과 같은 tx에서 부른다. */
@Injectable()
export class MasterChangeRecorder {
  constructor(
    private readonly events: BusinessEventRecorder,
    private readonly realtime: RealtimeService,
  ) {}

  async record(tx: Tx, user: AuthUser, change: MasterChange): Promise<void> {
    await this.events.record(tx, {
      actor: user,
      eventType: 'MASTER_CHANGED',
      targetType: 'MASTER',
      targetId: change.targetId ?? null,
      targetNo: change.targetNo,
      summary: change.summary,
      before: change.before,
      after: change.after,
    });
    this.realtime.changed('master-data');
  }
}
