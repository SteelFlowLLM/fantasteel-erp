// 외부 연결 주기 확인(이슈 #518)의 간격 읽기와 타이머 만들기를 DB 없이 본다.
// 테스트(NODE_ENV=test)에서는 타이머를 만들지 않으므로, 이 파일은 NODE_ENV를 잠시 바꾸고 가짜 타이머로 onApplicationBootstrap을 본다.
import { Logger } from '@nestjs/common';
import type { GoogleDriveClient } from './google-drive/google-drive.client';
import { IntegrationHealthMonitor, MAX_CHECK_MINUTES, MIN_CHECK_MINUTES, healthCheckMinutes } from './integration-health.monitor';
import type { IntegrationTokenStore } from './integration-token.store';
import type { McpClientService } from './mcp/mcp.client';

describe('healthCheckMinutes (주기 확인 간격)', () => {
  it('비우면 기본 30분, 0이면 끈다, 1~1440분이면 그대로', () => {
    expect(healthCheckMinutes(undefined)).toBe(30);
    expect(healthCheckMinutes('')).toBe(30);
    expect(healthCheckMinutes('  ')).toBe(30);
    expect(healthCheckMinutes('0')).toBe(0);
    expect(healthCheckMinutes(String(MIN_CHECK_MINUTES))).toBe(1);
    expect(healthCheckMinutes('10')).toBe(10);
    expect(healthCheckMinutes('1.5')).toBe(1.5);
    expect(healthCheckMinutes(String(MAX_CHECK_MINUTES))).toBe(1440);
  });

  it('범위 밖이거나 숫자가 아니면 기본값으로 쓰고 이유를 알린다 (setInterval이 약 35,791분부터 1ms로 도는 것을 막는다)', () => {
    for (const raw of ['0.5', '0.0001', '-5', '1441', '35792', '999999999', 'abc', 'Infinity', 'NaN']) {
      const warn = jest.fn();
      expect(healthCheckMinutes(raw, warn)).toBe(30);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('INTEGRATION_HEALTH_CHECK_MINUTES');
    }
  });

  it('범위 안이면 경고하지 않는다', () => {
    const warn = jest.fn();
    for (const raw of [undefined, '', '0', '1', '30', '1440']) healthCheckMinutes(raw, warn);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('IntegrationHealthMonitor.onApplicationBootstrap (타이머)', () => {
  const savedNodeEnv = process.env.NODE_ENV;
  const savedMinutes = process.env.INTEGRATION_HEALTH_CHECK_MINUTES;
  let monitor: IntegrationHealthMonitor;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.NODE_ENV = 'development';
    monitor = new IntegrationHealthMonitor({} as IntegrationTokenStore, {} as McpClientService, {} as GoogleDriveClient);
  });

  afterEach(() => {
    monitor.onApplicationShutdown();
    jest.useRealTimers();
    jest.restoreAllMocks();
    process.env.NODE_ENV = savedNodeEnv;
    if (savedMinutes === undefined) delete process.env.INTEGRATION_HEALTH_CHECK_MINUTES;
    else process.env.INTEGRATION_HEALTH_CHECK_MINUTES = savedMinutes;
  });

  it('테스트 환경에서는 타이머를 만들지 않는다', () => {
    process.env.NODE_ENV = 'test';
    process.env.INTEGRATION_HEALTH_CHECK_MINUTES = '5';
    monitor.onApplicationBootstrap();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('0이면 타이머를 만들지 않는다 (확인하지 않음)', () => {
    process.env.INTEGRATION_HEALTH_CHECK_MINUTES = '0';
    monitor.onApplicationBootstrap();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('값이 있으면 첫 확인(30초 뒤)과 주기 타이머를 만들고, 종료하면 둘 다 지운다', () => {
    const interval = jest.spyOn(globalThis, 'setInterval');
    process.env.INTEGRATION_HEALTH_CHECK_MINUTES = '10';
    monitor.onApplicationBootstrap();
    expect(jest.getTimerCount()).toBe(2);
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 10 * 60_000);
    monitor.onApplicationShutdown();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('범위 밖 값은 기본 30분 간격으로 만들고 warn을 남긴다 (1ms 타이머가 되지 않는다)', () => {
    const interval = jest.spyOn(globalThis, 'setInterval');
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    process.env.INTEGRATION_HEALTH_CHECK_MINUTES = '99999999';
    monitor.onApplicationBootstrap();
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 30 * 60_000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('INTEGRATION_HEALTH_CHECK_MINUTES');
  });
});
