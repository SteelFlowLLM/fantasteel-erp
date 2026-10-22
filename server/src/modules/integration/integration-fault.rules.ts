import {
  INTEGRATION_FAULT_KIND,
  type ErrorCode,
  type IntegrationConnectionStatus,
  type IntegrationFaultKind,
  type IntegrationFaultView,
  type IntegrationHealthLevel,
  type IntegrationHealthView,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';

/**
 * 외부 연결 장애 규칙 (이슈 #518, 문서에 없는 기능). DB·Nest 없이 값만 다루는 순수 함수와 상수만 둔다.
 * 장애 알림은 연동 관리 권한자(ORG_MANAGE 사용)에게 가고, 화면은 관리 > 외부 연결이다.
 */

/** 알림을 누르면 가는 화면 */
export const INTEGRATION_ALERT_LINK = '/admin/integrations';

/** 풀리지 않은 같은 장애를 다시 알리기까지의 간격 (가정값: 하루 한 번) */
export const FAULT_REPEAT_MS = 24 * 60 * 60_000;

/**
 * 장애 알림을 보내기까지 이어져야 하는 실패 횟수 (가정값).
 * 사람이 고쳐야 하는 장애(다시 연결·키·설정)는 처음부터 알리고, 일시적일 수 있는 장애(요청·반영 실패)는 3번 이어질 때 알려
 * 한 번 흔들린 것까지 알림과 복구 알림으로 어지럽히지 않는다.
 */
export const FAULT_ALERT_AFTER: Record<IntegrationFaultKind, number> = {
  RECONNECT_REQUIRED: 1,
  CREDENTIAL_ERROR: 1,
  REQUEST_FAILED: 3,
  SYNC_FAILED: 3,
};

/** 성공한 호출이 풀어 주는 장애: 연결(토큰·키·요청)이 다시 되면 이 셋이 풀린다. 반영 실패(SYNC_FAILED)는 실패 목록이 비어야 풀린다 */
export const CONNECTION_FAULT_KINDS: readonly IntegrationFaultKind[] = [
  INTEGRATION_FAULT_KIND.RECONNECT_REQUIRED,
  INTEGRATION_FAULT_KIND.CREDENTIAL_ERROR,
  INTEGRATION_FAULT_KIND.REQUEST_FAILED,
];

/** 장애 알림·화면에 싣는 이유의 길이 (알림 한 줄이 너무 길어지지 않게) */
const ALERT_MESSAGE_MAX = 120;
/** integration_fault.last_message 칸 길이 (integration_connection.last_error와 같다) */
export const FAULT_MESSAGE_MAX = 500;

/**
 * 장애 종류를 직접 정하는 연동 오류. 오류 코드·문구·status는 AppException 그대로라 부르는 쪽 동작은 같고, 어떤 장애로 알릴지만 다르다.
 * 코드만으로는 가를 수 없을 때 쓴다: 같은 INT-004라도 서비스 계정 키 거절은 CREDENTIAL_ERROR(서버 관리자가 고침),
 * Drive 권한이 모자란 것은 RECONNECT_REQUIRED(관리자가 다시 연결), 일시적인 시간 초과는 REQUEST_FAILED다.
 */
export class IntegrationFaultException extends AppException {
  constructor(
    code: ErrorCode,
    message: string,
    public readonly faultKind: IntegrationFaultKind,
  ) {
    super(code, message);
  }
}

function isKnownKind(value: string): value is IntegrationFaultKind {
  return (Object.values(INTEGRATION_FAULT_KIND) as string[]).includes(value);
}

/**
 * 연결 호출이 실패했을 때 어떤 장애로 셀지. 연결 대상이 안 정해졌거나 사용 문제(INT-002 연결 안 함, INT-006 상위 페이지 없음, INT-012 파일 없음 …)는
 * 장애가 아니라서 null이다.
 */
export function faultKindOf(error: AppException): IntegrationFaultKind | null {
  if (error instanceof IntegrationFaultException) return error.faultKind;
  switch (error.code) {
    case 'INT-003':
      return INTEGRATION_FAULT_KIND.RECONNECT_REQUIRED;
    case 'INT-008':
    case 'INT-015':
      return INTEGRATION_FAULT_KIND.CREDENTIAL_ERROR;
    case 'INT-004':
    case 'INT-005':
      return INTEGRATION_FAULT_KIND.REQUEST_FAILED;
    default:
      return null;
  }
}

export function cutMessage(message: string, max: number): string {
  const oneLine = message.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** 장애 알림 한 줄 (알림 유형 배지 '연동 장애'가 따로 보이므로 접두어는 붙이지 않는다) */
export function faultAlertContent(input: { displayName: string; faultKind: IntegrationFaultKind; message: string; failureCount: number }): string {
  const reason = cutMessage(input.message, ALERT_MESSAGE_MAX);
  switch (input.faultKind) {
    case INTEGRATION_FAULT_KIND.RECONNECT_REQUIRED:
      return `${input.displayName} 연결이 끊겼어요. 관리 › 외부 연결에서 다시 연결해 주세요${reason ? ` (${reason})` : ''}`;
    case INTEGRATION_FAULT_KIND.CREDENTIAL_ERROR:
      return `${input.displayName} 키·설정에 문제가 있어요. 서버 관리자가 확인해 주세요 (${reason})`;
    case INTEGRATION_FAULT_KIND.REQUEST_FAILED:
      return `${input.displayName} 요청이 ${input.failureCount}번 이어서 실패했어요 (${reason})`;
    case INTEGRATION_FAULT_KIND.SYNC_FAILED:
      return `${input.displayName} 업무 공간 반영이 ${input.failureCount}번 이어서 실패했어요. 관리 › 외부 연결에서 실패 목록을 확인해 주세요 (${reason})`;
  }
}

/** 장애가 풀렸다는 알림 한 줄 */
export function faultRecoveredContent(input: { displayName: string; faultKind: IntegrationFaultKind }): string {
  switch (input.faultKind) {
    case INTEGRATION_FAULT_KIND.RECONNECT_REQUIRED:
      return `${input.displayName} 연결이 다시 정상이에요`;
    case INTEGRATION_FAULT_KIND.CREDENTIAL_ERROR:
      return `${input.displayName} 키·설정 오류가 해결됐어요`;
    case INTEGRATION_FAULT_KIND.REQUEST_FAILED:
      return `${input.displayName} 요청이 다시 정상이에요`;
    case INTEGRATION_FAULT_KIND.SYNC_FAILED:
      return `${input.displayName} 업무 공간 반영이 다시 정상이에요`;
  }
}

/** 화면에 보일 장애 목록 순서: 급한 것(다시 연결·키)이 먼저 */
const KIND_ORDER = Object.values(INTEGRATION_FAULT_KIND);

export interface FaultRowInput {
  faultKind: string;
  lastMessage: string;
  failureCount: number;
  firstFailedAt: Date;
  lastFailedAt: Date;
  notifiedAt: Date | null;
}

export function toFaultView(row: FaultRowInput): IntegrationFaultView | null {
  if (!isKnownKind(row.faultKind)) return null;
  return {
    faultKind: row.faultKind,
    message: row.lastMessage,
    failureCount: row.failureCount,
    firstFailedAt: row.firstFailedAt.toISOString(),
    lastFailedAt: row.lastFailedAt.toISOString(),
    notifiedAt: row.notifiedAt?.toISOString() ?? null,
  };
}

export interface HealthInput {
  status: IntegrationConnectionStatus;
  /** 화면에 보이는 마지막 오류 (서버 설정 오류가 지난 호출의 실패보다 먼저다) */
  lastError: string | null;
  /** 보이는 마지막 오류를 남긴 시각. 서버 설정 오류처럼 시각이 없는 오류면 null */
  lastErrorAt: Date | null;
  /** 서버 설정(.env)을 읽지 못한 오류: 호출해 보지 않아도 이미 쓸 수 없다 */
  configError: string | null;
  faults: readonly FaultRowInput[];
  /** 반영 실패 목록(notion_sync_failure)에 남은 행 수 */
  syncFailedCount: number;
  /** Notion 데이터베이스 보기를 만들지 못했다는 안내 */
  setupWarning: string | null;
}

/**
 * 연결 상태 신호등. 끊김 = 사람이 다시 연결하거나 서버 설정을 고쳐야 한다. 주의 = 일시적으로 실패했거나 반영 실패가 남아 있다.
 * 연결한 적 없고 문제도 없으면 NORMAL이다 (화면은 연결 상태 배지 '연결 안 됨'으로 보인다).
 */
export function healthOf(input: HealthInput): IntegrationHealthView {
  const faults = input.faults
    .map(toFaultView)
    .filter((fault): fault is IntegrationFaultView => fault !== null)
    .sort((a, b) => KIND_ORDER.indexOf(a.faultKind) - KIND_ORDER.indexOf(b.faultKind));
  const down =
    input.status === 'RECONNECT_REQUIRED' ||
    input.configError !== null ||
    faults.some((fault) => fault.faultKind === INTEGRATION_FAULT_KIND.RECONNECT_REQUIRED || fault.faultKind === INTEGRATION_FAULT_KIND.CREDENTIAL_ERROR);
  const warning = faults.length > 0 || input.lastError !== null || input.syncFailedCount > 0 || input.setupWarning !== null;
  const level: IntegrationHealthLevel = down ? 'DOWN' : warning ? 'WARNING' : 'NORMAL';
  return { level, lastErrorAt: input.lastError !== null ? (input.lastErrorAt?.toISOString() ?? null) : null, faults };
}
