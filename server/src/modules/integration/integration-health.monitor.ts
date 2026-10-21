import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { INTEGRATION_PROVIDER } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { GoogleDriveClient } from './google-drive/google-drive.client';
import { IntegrationTokenStore } from './integration-token.store';
import { McpClientService } from './mcp/mcp.client';

/** 연결 상태를 확인하는 기본 주기 (가정값). INTEGRATION_HEALTH_CHECK_MINUTES로 바꾸고 0이면 확인하지 않는다 */
const DEFAULT_CHECK_MINUTES = 30;
/** 서버를 띄운 직후 한 번 확인하기까지: 부팅 작업(마이그레이션 뒤 첫 요청, 서비스 계정 키 읽기)이 끝난 뒤 */
const FIRST_CHECK_DELAY_MS = 30_000;

/** 확인 주기(분). 읽을 수 없거나 음수면 기본값, 0이면 끈다 */
export function healthCheckMinutes(raw: string | undefined = process.env.INTEGRATION_HEALTH_CHECK_MINUTES): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_CHECK_MINUTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CHECK_MINUTES;
}

/**
 * 외부 연결 상태 확인 (이슈 #518, 문서에 없는 기능). 연결은 쓰이는 때에만 확인되므로, 아무도 쓰지 않는 동안 일어난 장애
 * (Google Drive 외부+테스트 앱의 7일 만료, 삭제된 서비스 계정 키, Notion 토큰 갱신 거절)가 누군가 쓰기 전까지 모르는 채로 남지 않게 주기로 확인한다.
 * Notion은 도구 목록을 받아 보고, Google Drive는 `about` 요청으로 토큰과 Drive API를 본다. 실패는 호출 쪽이 마지막 오류와 장애(알림 포함)로 남기므로
 * 여기서는 던지지 않는다. 연결한 적도 키를 넣은 적도 없는 연결 대상은 건드리지 않는다. 테스트(NODE_ENV=test)에서는 돌지 않고 runNow로 직접 부른다.
 */
@Injectable()
export class IntegrationHealthMonitor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(IntegrationHealthMonitor.name);
  private timer: NodeJS.Timeout | null = null;
  private firstTimer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly store: IntegrationTokenStore,
    private readonly mcp: McpClientService,
    private readonly drive: GoogleDriveClient,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    const minutes = healthCheckMinutes();
    if (minutes === 0) return;
    this.firstTimer = setTimeout(() => void this.runNow(), FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(() => void this.runNow(), minutes * 60_000);
    // 타이머가 서버 종료를 붙잡지 않게 한다
    this.firstTimer.unref();
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.timer) clearInterval(this.timer);
  }

  /** 연결을 한 번 확인하고 끝날 때까지 기다린다. 이미 확인 중이면 그것을 기다린다 */
  runNow(): Promise<void> {
    if (this.running) return this.running;
    const run = this.check().finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  private async check(): Promise<void> {
    await this.guarded('Notion', () => this.checkNotion());
    await this.guarded('Google Drive', () => this.drive.checkHealth());
  }

  private async guarded(name: string, task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (error) {
      // 연결 문제(AppException)는 이미 장애로 남았다. 그 밖은 서버 쪽 문제라 로그만 남긴다
      if (!(error instanceof AppException)) this.logger.warn(`${name} 연결 확인 중 오류: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async checkNotion(): Promise<void> {
    const state = await this.store.connectionState(INTEGRATION_PROVIDER.NOTION);
    // 연결한 적이 없으면 확인할 것이 없다. 연결했다가 끊겼으면 withSession이 다시 연결이 필요한 장애로 남긴다
    if (!state.hasTokens && !state.wasConnected) return;
    await this.mcp.withSession(INTEGRATION_PROVIDER.NOTION, (session) => session.listTools());
  }
}
