import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { FactoryAgentService } from './factory-agent.service';

/** 🟡 TBD: 스케줄 주기 (BP-AGT-01). 기본 24시간, AGENT_SCAN_INTERVAL_HOURS로 바꾸고 0이면 돌리지 않는다 */
const DEFAULT_INTERVAL_HOURS = 24;

/**
 * 스케줄 트리거 (REQ-AGT-001). 스케줄 패키지를 새로 들이지 않고 타이머로 돌린다.
 * 테스트(NODE_ENV=test)에서는 돌리지 않는다. 서버를 띄운 직후 한 번, 그 뒤 주기마다 규칙을 돌린다.
 */
@Injectable()
export class FactoryAgentScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(FactoryAgentScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly agent: FactoryAgentService) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    const parsed = Number(process.env.AGENT_SCAN_INTERVAL_HOURS ?? DEFAULT_INTERVAL_HOURS);
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
      const results = await this.agent.scanAll();
      this.logger.log(`Agent 감지 완료: ${results.map((r) => `${r.riskType} ${r.created}/${r.detected}`).join(', ') || '없음'}`);
    } catch (e) {
      this.logger.warn(`Agent 감지에 실패했어요: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
