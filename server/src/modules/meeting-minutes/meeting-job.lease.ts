import { Logger } from '@nestjs/common';
import type { MeetingMinutesStatus } from '@fantasteel/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MeetingMinutesRepository } from './meeting-minutes.repository';

/** 맡은 작업이 살아 있다고 표시하는 간격 */
export const JOB_HEARTBEAT_MS = 2 * 60_000;
/** 이만큼 표시가 없으면 맡은 서버가 멈춘 것으로 본다. 표시 간격보다 넉넉히 길게 둬 DB가 잠깐 느려도 남의 작업을 실패로 만들지 않는다 */
export const JOB_STALE_MS = 10 * 60_000;

/**
 * 전사·분석 작업을 이 서버가 맡고 있다는 표시 (공용 DB에서 여러 서버가 같은 회의록 표를 쓴다).
 * 맡은 행은 updated_at을 주기적으로 갱신하고, 정리할 때는 오래 갱신되지 않은 행만 실패로 돌린다.
 * 예전처럼 켤 때 진행 중 행을 모두 실패로 돌리면 다른 팀원 서버가 처리 중이던 작업까지 실패가 된다.
 */
export class MeetingJobLease {
  private readonly owned = new Set<number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MeetingMinutesRepository,
    private readonly status: MeetingMinutesStatus,
    private readonly failureReason: string,
    private readonly logger: Logger,
    private readonly label: string,
  ) {}

  /** 줄을 선 순간부터 맡는다: 앞 작업이 길어 오래 기다려도 표시가 이어진다 */
  hold(id: number): void {
    this.owned.add(id);
  }

  release(id: number): void {
    this.owned.delete(id);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), JOB_HEARTBEAT_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 마지막 표시가 오래된 행을 실패로 돌린다. 이 서버가 맡은 행은 빼낸다 */
  async recoverStale(now = new Date()): Promise<number> {
    const { count } = await this.repository.failStale(this.prisma, this.status, new Date(now.getTime() - JOB_STALE_MS), [...this.owned], this.failureReason);
    if (count > 0) this.logger.warn(`${this.label}이 멈춘 회의록 ${count}건을 실패로 바꿨어요`);
    return count;
  }

  async heartbeat(): Promise<void> {
    if (this.owned.size > 0) await this.repository.touchInProgress(this.prisma, [...this.owned], this.status);
  }

  private async tick(): Promise<void> {
    try {
      await this.heartbeat();
      await this.recoverStale();
    } catch (error) {
      this.logger.warn(`${this.label} 작업 표시 갱신 실패: ${error instanceof Error ? error.name : 'unknown'}`);
    }
  }
}
