// 외부 연결 장애 규칙 (이슈 #518): 어떤 오류가 어떤 장애인지, 알림 문구, 연결 상태 신호등을 DB 없이 본다.
import { AppException } from '../../common/errors/app.exception';
import {
  CONNECTION_FAULT_KINDS,
  FAULT_ALERT_AFTER,
  FAULT_REPEAT_MS,
  IntegrationFaultException,
  cutMessage,
  faultAlertContent,
  faultKindOf,
  faultRecoveredContent,
  healthOf,
  type HealthInput,
} from './integration-fault.rules';
import { healthCheckMinutes } from './integration-health.monitor';

describe('faultKindOf (오류 → 장애 종류)', () => {
  it('다시 연결이 필요한 INT-003은 RECONNECT_REQUIRED', () => {
    expect(faultKindOf(new AppException('INT-003'))).toBe('RECONNECT_REQUIRED');
  });

  it('서버 설정·키 오류(INT-008·INT-015)는 CREDENTIAL_ERROR', () => {
    expect(faultKindOf(new AppException('INT-008'))).toBe('CREDENTIAL_ERROR');
    expect(faultKindOf(new AppException('INT-015'))).toBe('CREDENTIAL_ERROR');
  });

  it('요청 실패·도구 없음(INT-004·INT-005)은 REQUEST_FAILED', () => {
    expect(faultKindOf(new AppException('INT-004'))).toBe('REQUEST_FAILED');
    expect(faultKindOf(new AppException('INT-005'))).toBe('REQUEST_FAILED');
  });

  it('사용 문제(연결 안 함·상위 페이지 없음·폴더 없음·파일 크기)는 장애가 아니다', () => {
    for (const code of ['INT-001', 'INT-002', 'INT-006', 'INT-007', 'INT-009', 'INT-010', 'INT-011', 'INT-012', 'INT-013', 'INT-014', 'INT-016'] as const) {
      expect(faultKindOf(new AppException(code))).toBeNull();
    }
  });

  it('IntegrationFaultException은 같은 코드라도 지정한 종류로 센다 (코드·status는 그대로)', () => {
    const credential = new IntegrationFaultException('INT-004', '서비스 계정 키를 거절했어요', 'CREDENTIAL_ERROR');
    expect(credential.code).toBe('INT-004');
    expect(credential.getStatus()).toBe(502);
    expect(credential).toBeInstanceOf(AppException);
    expect(faultKindOf(credential)).toBe('CREDENTIAL_ERROR');
    expect(faultKindOf(new IntegrationFaultException('INT-004', '권한이 부족해요', 'RECONNECT_REQUIRED'))).toBe('RECONNECT_REQUIRED');
  });
});

describe('알림 기준', () => {
  it('사람이 고쳐야 하는 장애는 처음부터, 일시적일 수 있는 장애는 3번 이어질 때 알린다', () => {
    expect(FAULT_ALERT_AFTER).toEqual({ RECONNECT_REQUIRED: 1, CREDENTIAL_ERROR: 1, REQUEST_FAILED: 3, SYNC_FAILED: 3 });
  });

  it('같은 장애는 하루에 한 번만 다시 알린다', () => {
    expect(FAULT_REPEAT_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('성공한 호출이 푸는 장애는 연결 장애 셋이고 반영 실패는 아니다', () => {
    expect([...CONNECTION_FAULT_KINDS]).toEqual(['RECONNECT_REQUIRED', 'CREDENTIAL_ERROR', 'REQUEST_FAILED']);
  });
});

describe('알림 문구', () => {
  it('장애 종류마다 무엇을 하라는 말이 다르다', () => {
    expect(faultAlertContent({ displayName: 'Google Drive', faultKind: 'RECONNECT_REQUIRED', message: 'Google 인증이 만료됐어요', failureCount: 1 })).toBe(
      'Google Drive 연결이 끊겼어요. 관리 › 외부 연결에서 다시 연결해 주세요 (Google 인증이 만료됐어요)',
    );
    expect(faultAlertContent({ displayName: 'Google Drive', faultKind: 'CREDENTIAL_ERROR', message: '서비스 계정 키를 거절했어요', failureCount: 1 })).toContain('서버 관리자가 확인해 주세요');
    expect(faultAlertContent({ displayName: 'Notion', faultKind: 'REQUEST_FAILED', message: '시간 초과', failureCount: 3 })).toBe('Notion 요청이 3번 이어서 실패했어요 (시간 초과)');
    expect(faultAlertContent({ displayName: 'Notion', faultKind: 'SYNC_FAILED', message: '반영에 실패한 행이 2건 있어요', failureCount: 3 })).toContain('실패 목록을 확인해 주세요');
  });

  it('이유가 길면 한 줄로 자르고 줄바꿈을 접는다', () => {
    const long = `첫 줄\n둘째 줄 ${'가'.repeat(300)}`;
    const cut = cutMessage(long, 120);
    expect(cut.length).toBe(120);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toContain('\n');
  });

  it('복구 문구', () => {
    expect(faultRecoveredContent({ displayName: 'Google Drive', faultKind: 'RECONNECT_REQUIRED' })).toBe('Google Drive 연결이 다시 정상이에요');
    expect(faultRecoveredContent({ displayName: 'Notion', faultKind: 'SYNC_FAILED' })).toBe('Notion 업무 공간 반영이 다시 정상이에요');
    expect(faultRecoveredContent({ displayName: 'Google Drive', faultKind: 'CREDENTIAL_ERROR' })).toBe('Google Drive 키·설정 오류가 해결됐어요');
  });
});

describe('연결 상태 신호등 (healthOf)', () => {
  const base: HealthInput = { status: 'CONNECTED', lastError: null, lastErrorAt: null, configError: null, faults: [], syncFailedCount: 0, setupWarning: null };
  const fault = (faultKind: string, notifiedAt: Date | null = null) => ({
    faultKind,
    lastMessage: '이유',
    failureCount: 2,
    firstFailedAt: new Date('2026-10-22T00:00:00.000Z'),
    lastFailedAt: new Date('2026-10-22T01:00:00.000Z'),
    notifiedAt,
  });

  it('문제가 없으면 정상', () => {
    expect(healthOf(base)).toEqual({ level: 'NORMAL', lastErrorAt: null, faults: [] });
  });

  it('연결한 적 없고 문제도 없으면 정상 (화면은 연결 안 됨 배지로 보인다)', () => {
    expect(healthOf({ ...base, status: 'NOT_CONNECTED' }).level).toBe('NORMAL');
  });

  it('다시 연결이 필요하면 끊김', () => {
    expect(healthOf({ ...base, status: 'RECONNECT_REQUIRED' }).level).toBe('DOWN');
    expect(healthOf({ ...base, faults: [fault('RECONNECT_REQUIRED')] }).level).toBe('DOWN');
  });

  it('서버 설정·키 오류도 끊김', () => {
    expect(healthOf({ ...base, faults: [fault('CREDENTIAL_ERROR')] }).level).toBe('DOWN');
    expect(healthOf({ ...base, status: 'NOT_CONNECTED', configError: 'GOOGLE_SERVICE_ACCOUNT_KEY_FILE: 키 파일을 찾을 수 없어요', lastError: 'GOOGLE_SERVICE_ACCOUNT_KEY_FILE: 키 파일을 찾을 수 없어요' }).level).toBe('DOWN');
  });

  it('일시 실패·반영 실패·마지막 오류·보기 안내는 주의', () => {
    expect(healthOf({ ...base, faults: [fault('REQUEST_FAILED')] }).level).toBe('WARNING');
    expect(healthOf({ ...base, faults: [fault('SYNC_FAILED')] }).level).toBe('WARNING');
    expect(healthOf({ ...base, lastError: '시간 초과', lastErrorAt: new Date('2026-10-22T02:00:00.000Z') }).level).toBe('WARNING');
    expect(healthOf({ ...base, syncFailedCount: 1 }).level).toBe('WARNING');
    expect(healthOf({ ...base, setupWarning: '보기를 만들지 못했어요' }).level).toBe('WARNING');
  });

  it('끊김이 주의보다 먼저다', () => {
    expect(healthOf({ ...base, faults: [fault('REQUEST_FAILED'), fault('RECONNECT_REQUIRED')], syncFailedCount: 3 }).level).toBe('DOWN');
  });

  it('장애는 급한 것부터, 알린 시각과 함께 보인다. 모르는 종류는 버린다', () => {
    const notifiedAt = new Date('2026-10-22T03:00:00.000Z');
    const view = healthOf({ ...base, faults: [fault('SYNC_FAILED'), fault('UNKNOWN'), fault('RECONNECT_REQUIRED', notifiedAt)] });
    expect(view.faults.map((f) => f.faultKind)).toEqual(['RECONNECT_REQUIRED', 'SYNC_FAILED']);
    expect(view.faults[0]).toMatchObject({ failureCount: 2, message: '이유', notifiedAt: notifiedAt.toISOString(), firstFailedAt: '2026-10-22T00:00:00.000Z' });
    expect(view.faults[1].notifiedAt).toBeNull();
  });

  it('마지막 오류 시각은 오류가 있을 때만 보인다', () => {
    const at = new Date('2026-10-22T02:00:00.000Z');
    expect(healthOf({ ...base, lastError: '시간 초과', lastErrorAt: at }).lastErrorAt).toBe(at.toISOString());
    expect(healthOf({ ...base, lastError: null, lastErrorAt: at }).lastErrorAt).toBeNull();
    expect(healthOf({ ...base, lastError: '서버 설정 오류', lastErrorAt: null }).lastErrorAt).toBeNull();
  });
});

describe('healthCheckMinutes (주기 확인)', () => {
  it('비우면 기본 30분, 0이면 끈다, 잘못된 값은 기본값', () => {
    expect(healthCheckMinutes(undefined)).toBe(30);
    expect(healthCheckMinutes('')).toBe(30);
    expect(healthCheckMinutes('10')).toBe(10);
    expect(healthCheckMinutes('0')).toBe(0);
    expect(healthCheckMinutes('-5')).toBe(30);
    expect(healthCheckMinutes('abc')).toBe(30);
  });
});
