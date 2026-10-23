import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';

/** 🟡 TBD: 보정 주기. 요구사항은 "주기적으로"만 정했다. 기본 24시간(Factory Agent와 같음), RESERVATION_RECONCILE_INTERVAL_HOURS로 바꾸고 0이면 돌리지 않는다 */
const DEFAULT_INTERVAL_HOURS = 24;

/**
 * 정합성 보정 주기 실행 (REQ-INV-010 "주기적으로 비교·보정"). Factory Agent 스케줄러처럼 타이머로 돌린다.
 * 테스트(NODE_ENV=test)에서는 돌리지 않는다. 서버를 띄운 직후 한 번, 그 뒤 주기마다.
 */
@Injectable()
export class ReconciliationScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReconciliationScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly reconciliation: ReconciliationService) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    const parsed = Number(process.env.RESERVATION_RECONCILE_INTERVAL_HOURS ?? DEFAULT_INTERVAL_HOURS);
    const hours = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_INTERVAL_HOURS;
    if (hours === 0) return;
    void this.run();
    this.timer = setInterval(() => void this.run(), hours * 60 * 60 * 1000);
    // 타이머가 서버 종료를 붙잡지 않게 한다
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    try {
      const result = await this.reconciliation.reconcile(null);
      this.logger.log(`정합성 보정 완료: 규격 ${result.checkedItemCount}개 점검, 보정 ${result.correctedCount}, 보정 불가 ${result.unfixableCount}`);
    } catch (e) {
      this.logger.warn(`정합성 보정에 실패했어요: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
