import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { AI_APPROVAL_TIMEOUT_MS, type AiApprovalDecision, type AiApprovalResolution, type AuthUser } from '@fantasteel/shared';
import { randomUUID } from 'node:crypto';
import { AppException } from '../../../common/errors/app.exception';

/** 끝난 카드를 기억하는 시간. 늦게 온 허용·거부에 '이미 처리됨'(409)으로 답하려고 둔다 */
export const RESOLVED_APPROVAL_RETENTION_MS = 10 * 60 * 1000;

export interface PendingApproval {
  id: string;
  expiresAt: Date;
  /** 허용·거부·시간 초과 중 처음 것. 연결이 끊기면 거부 */
  decision: Promise<AiApprovalResolution>;
}

interface Slot {
  employeeId: number;
  resolution: AiApprovalResolution | null;
  settle: (resolution: AiApprovalResolution) => void;
  timer: NodeJS.Timeout;
}

/**
 * 승인 카드 자리 (이슈 #362). 서버 한 대의 메모리에 둔다: 서버를 다시 띄우면 기다리던 카드는 사라지고(스트림도 끊겨 거부와 같다),
 * 서버를 여러 대로 늘리면 허용 요청이 다른 서버로 갈 수 있어 공유 저장소로 옮겨야 한다.
 * 자리는 이벤트를 보내기 전에 만든다: 화면이 아주 빨리 허용해도 자리가 이미 있다.
 */
@Injectable()
export class AssistantApprovalRegistry implements OnModuleDestroy {
  private readonly slots = new Map<string, Slot>();

  /** 카드 자리를 만든다. signal이 끊기면(화면이 연결을 끊음) 거부로 끝낸다 */
  open(employeeId: number, signal?: AbortSignal, timeoutMs: number = AI_APPROVAL_TIMEOUT_MS): PendingApproval {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + timeoutMs);
    let settle: (resolution: AiApprovalResolution) => void = () => undefined;
    const decision = new Promise<AiApprovalResolution>((resolve) => {
      settle = resolve;
    });
    const onAbort = () => this.settle(id, 'DENY');
    const slot: Slot = {
      employeeId,
      resolution: null,
      settle: (resolution) => {
        signal?.removeEventListener('abort', onAbort);
        settle(resolution);
      },
      timer: setTimeout(() => this.settle(id, 'TIMEOUT'), timeoutMs),
    };
    slot.timer.unref();
    this.slots.set(id, slot);
    if (signal?.aborted) this.settle(id, 'DENY');
    else signal?.addEventListener('abort', onAbort, { once: true });
    return { id, expiresAt, decision };
  }

  /** 사용자가 고른 값. 질문한 사원만, 처음 한 번만 받는다 */
  decide(user: AuthUser, id: string, decision: AiApprovalDecision): void {
    const slot = this.slots.get(id);
    if (!slot) throw new AppException('AST-001');
    if (slot.employeeId !== user.employeeId) throw new AppException('COM-002', '질문한 사람만 허용·거부할 수 있어요');
    if (slot.resolution === 'TIMEOUT') throw new AppException('AST-002', '10분이 지나 거부로 처리된 승인 요청이에요');
    if (slot.resolution !== null) throw new AppException('AST-002');
    this.settle(id, decision);
  }

  /** 기다리는 카드 수 (시험·점검용) */
  pendingCount(): number {
    return [...this.slots.values()].filter((slot) => slot.resolution === null).length;
  }

  onModuleDestroy(): void {
    for (const [id, slot] of this.slots) {
      if (slot.resolution === null) this.settle(id, 'DENY');
      clearTimeout(slot.timer);
    }
    this.slots.clear();
  }

  private settle(id: string, resolution: AiApprovalResolution): void {
    const slot = this.slots.get(id);
    if (!slot || slot.resolution !== null) return;
    slot.resolution = resolution;
    clearTimeout(slot.timer);
    slot.settle(resolution);
    slot.timer = setTimeout(() => this.slots.delete(id), RESOLVED_APPROVAL_RETENTION_MS);
    slot.timer.unref();
  }
}
