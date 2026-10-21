// 외부 연결 도우미: 상태 문구·색, 콜백 쿼리 읽기, 회의록 Notion 내보내기 버튼 조건 (이슈 #358), Google Drive 카드·녹음 가져오기 조건 (이슈 #361),
// Notion 업무 공간 만들기 조건·상태 문구, Notion 캘린더 고르기 (이슈 #391), 연결 상태(정상·주의·끊김)·장애·반영 실패 목록 문구 (이슈 #518).
import {
  INTEGRATION_PROVIDER,
  MEETING_AUDIO_MAX_BYTES,
  MEETING_MINUTES_STATUS,
  NOTION_SYNC_TARGET_LABEL,
  type DriveFileView,
  type IntegrationConnectionStatus,
  type IntegrationConnectionView,
  type IntegrationFaultView,
  type IntegrationHealthLevel,
  type IntegrationProviderKey,
  type IntegrationSettingsInput,
  type MeetingMinutesView,
  type NotionCalendarOption,
  type NotionCalendarSettings,
  type NotionCalendarSettingsInput,
  type NotionSyncFailureView,
  type NotionSyncRetryResult,
  type NotionWorkspaceView,
} from '@fantasteel/shared';
import { PERMISSION } from '@/codes';
import type { BadgeTone } from '@/components/Badge';
import { fmtBytes, relTime } from '@/lib/format';
import { canUse, type PermissionMap } from '@/lib/permissions';

export const INTEGRATION_STATUS_LABEL: Record<IntegrationConnectionStatus, string> = {
  CONNECTED: '연결됨',
  RECONNECT_REQUIRED: '다시 연결 필요',
  NOT_CONNECTED: '연결 안 됨',
};

export const INTEGRATION_STATUS_TONE: Record<IntegrationConnectionStatus, BadgeTone> = {
  CONNECTED: 'ok',
  RECONNECT_REQUIRED: 'wait',
  NOT_CONNECTED: 'neutral',
};

export const INTEGRATION_HEALTH_LABEL: Record<IntegrationHealthLevel, string> = {
  NORMAL: '정상',
  WARNING: '주의',
  DOWN: '끊김',
};

export const INTEGRATION_HEALTH_TONE: Record<IntegrationHealthLevel, BadgeTone> = {
  NORMAL: 'ok',
  WARNING: 'wait',
  DOWN: 'danger',
};

/**
 * 정상·주의·끊김 배지를 보일지. 연결한 적 없고 문제도 없으면 '연결 안 됨' 배지만 보인다 (정상이라고 하면 연결된 것처럼 보인다).
 * 서버 설정 오류처럼 연결 안 됨인데 끊김인 것은 보인다.
 */
export function showIntegrationHealth(connection: Pick<IntegrationConnectionView, 'status' | 'health'>): boolean {
  return connection.status !== 'NOT_CONNECTED' || connection.health.level !== 'NORMAL';
}

/** 장애 한 줄(종류 배지 옆에 붙는다): 몇 번 이어서 실패했는지 · 마지막 실패 시각 · 관리자에게 알렸는지 */
export function integrationFaultLine(fault: IntegrationFaultView, now: Date = new Date()): string {
  const notified = fault.notifiedAt ? `관리자에게 알렸어요(${relTime(fault.notifiedAt, now)})` : '아직 알리지 않았어요';
  return `${fault.failureCount}번 이어서 실패 · 마지막 ${relTime(fault.lastFailedAt, now)} · ${notified}`;
}

/** 반영 실패 목록 설명 */
export const NOTION_SYNC_FAILURES_NOTE =
  'Notion에 옮기지 못한 일정·회의록·할 일이에요. 서버가 1분마다 다시 해 보고(실패할수록 간격이 늘어요), 여기서 바로 다시 시도할 수도 있어요. 서버를 다시 띄워도 목록은 남아요.';

/** 실패 행 이름: 일정 · 회의록 · 할 일 */
export function notionSyncTargetLabel(failure: Pick<NotionSyncFailureView, 'targetType'>): string {
  return NOTION_SYNC_TARGET_LABEL[failure.targetType];
}

/** 다음 자동 시도까지. 이미 지났으면 다음 반영(1분 안)에 다시 한다 */
export function syncFailureNextLabel(failure: Pick<NotionSyncFailureView, 'retryAfter'>, now: Date = new Date()): string {
  const minutes = Math.ceil((new Date(failure.retryAfter).getTime() - now.getTime()) / 60_000);
  if (Number.isNaN(minutes) || minutes <= 0) return '다음 반영(1분 안)에 다시 해요';
  if (minutes >= 60) return `다음 자동 시도: ${Math.round(minutes / 60)}시간 뒤`;
  return `다음 자동 시도: ${minutes}분 뒤`;
}

/** 만들어졌는지 알 수 없던 건을 다시 시도하기 전에 보일 확인 문구. 그렇지 않으면 null (바로 시도한다) */
export function syncRetryConfirmText(failure: Pick<NotionSyncFailureView, 'isResultUnknown' | 'title'>): string | null {
  if (!failure.isResultUnknown) return null;
  return `「${failure.title}」는 Notion에 페이지가 만들어졌는지 알 수 없었어요. 이미 만들어졌다면 다시 시도할 때 같은 페이지가 하나 더 생겨요. Notion에서 먼저 확인했나요?`;
}

/** 다시 시도 결과를 알리는 토스트 */
export function syncRetryToast(result: NotionSyncRetryResult): { tone: 'ok' | 'error'; text: string } {
  if (result.requested === 0) return { tone: 'ok', text: '다시 시도할 반영 실패가 없어요' };
  if (result.failed === 0) return { tone: 'ok', text: `${result.succeeded}건을 Notion에 반영했어요` };
  if (result.succeeded === 0) return { tone: 'error', text: `${result.failed}건이 또 실패했어요. 이유를 확인해 주세요` };
  return { tone: 'error', text: `${result.succeeded}건은 반영했고 ${result.failed}건은 또 실패했어요` };
}

/** OAuth 콜백이 돌려보낸 주소의 쿼리 (?integration=notion&result=connected|error&message=…) */
export interface IntegrationCallbackNotice {
  providerKey: IntegrationProviderKey | null;
  result: 'connected' | 'error';
  message: string | null;
}

/** 콜백 쿼리를 읽는다. result가 없거나 모르는 값이면 null (일반 방문) */
export function parseIntegrationCallback(params: Pick<URLSearchParams, 'get'>): IntegrationCallbackNotice | null {
  const result = params.get('result');
  if (result !== 'connected' && result !== 'error') return null;
  const integration = params.get('integration');
  const providerKey = Object.values(INTEGRATION_PROVIDER).find((key) => key === integration) ?? null;
  const message = params.get('message')?.trim() || null;
  return { providerKey, result, message };
}

/** 콜백 쿼리(integration·result·message)만 지운 쿼리 문자열. 다른 쿼리는 남긴다 */
export function withoutCallbackParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of ['integration', 'result', 'message']) params.delete(key);
  return params.toString();
}

export function notionConnection(integrations: readonly IntegrationConnectionView[] | undefined): IntegrationConnectionView | undefined {
  return integrations?.find((item) => item.providerKey === INTEGRATION_PROVIDER.NOTION);
}

/** 연결되어 있고 회의록을 둘 상위 페이지가 정해져 있는지 */
export function isNotionExportReady(connection: IntegrationConnectionView | undefined): boolean {
  return connection?.status === 'CONNECTED' && !!connection.settings.parentPageId;
}

/** 이 회의록에서 "Notion으로 내보내기" 버튼을 보일지: 확정, 아직 안 내보냄, 연결·상위 페이지 준비, 작성자 또는 ORG_MANAGE 사용 */
export function canExportMeetingToNotion(
  minutes: Pick<MeetingMinutesView, 'meetingMinutesStatus' | 'notionPageUrl' | 'creator'>,
  user: { employeeId: number; permissions: PermissionMap },
  connection: IntegrationConnectionView | undefined,
): boolean {
  if (minutes.meetingMinutesStatus !== MEETING_MINUTES_STATUS.CONFIRMED || minutes.notionPageUrl) return false;
  if (!isNotionExportReady(connection)) return false;
  return minutes.creator.id === user.employeeId || canUse(user, PERMISSION.ORG_MANAGE);
}

/** "Notion 업무 공간 만들기"가 막힌 이유. 막히지 않았으면 null. 저장한 상위 페이지 아래에 만들므로 고치던 값이 있으면 먼저 저장하게 한다 */
export function notionWorkspaceBlockReason(connection: IntegrationConnectionView, hasUnsavedChanges: boolean): string | null {
  if (connection.status !== 'CONNECTED') return 'Notion을 연결한 뒤 만들 수 있어요';
  if (!connection.settings.parentPageId) return '상위 페이지를 저장한 뒤 만들 수 있어요';
  if (hasUnsavedChanges) return '저장하지 않은 상위 페이지가 있어요. 먼저 저장해 주세요';
  return null;
}

/** 업무 공간 상태 한 줄: 안 만듦 · 만들다 멈춤(일부만) · 자동 반영 중 */
export function notionWorkspaceStatusLabel(workspace: NotionWorkspaceView | null): string {
  if (!workspace) return '아직 만들지 않았어요';
  if (!workspace.ready) return `일부만 만들었어요 (${workspace.databases.length}/3)`;
  return '자동으로 반영하고 있어요';
}

/** 반영 대기·실패 수 문구 */
export function notionWorkspaceSyncLabel(workspace: Pick<NotionWorkspaceView, 'pendingCount' | 'failedCount'>): string {
  if (workspace.pendingCount === 0 && workspace.failedCount === 0) return '모두 반영했어요';
  const parts = [workspace.pendingCount > 0 ? `${workspace.pendingCount}건 기다리는 중` : null, workspace.failedCount > 0 ? `${workspace.failedCount}건 실패(잠시 뒤 다시)` : null];
  return parts.filter(Boolean).join(' · ');
}

/** Notion 캘린더 목록이 비었을 때 안내 */
export const NOTION_CALENDAR_EMPTY_HINT = '연결한 Notion 계정에 캘린더가 없어요. 회사 Notion 계정으로 Notion 캘린더(calendar.notion.so)에 들어가 Google 캘린더를 먼저 연결해 주세요';

/** 캘린더 고르기 값 (계정 + 캘린더). 계정 id·캘린더 id에 어떤 글자가 와도 겹치지 않게 인코딩한다 */
export function notionCalendarKey(calendar: Pick<NotionCalendarOption, 'accountId' | 'calendarId'>): string {
  return `${encodeURIComponent(calendar.accountId)}|${encodeURIComponent(calendar.calendarId)}`;
}

/** 캘린더 고르기 한 줄: 이름 · 계정 메일 (읽기 전용) */
export function notionCalendarLabel(option: Pick<NotionCalendarOption, 'name' | 'accountEmail' | 'writable'>): string {
  return `${option.name}${option.accountEmail ? ` · ${option.accountEmail}` : ''}${option.writable === false ? ' (읽기 전용)' : ''}`;
}

/**
 * 캘린더 저장 본문. 다른 캘린더를 골랐으면 계정·캘린더·초대 여부, 초대 여부만 바꿨으면 그것만, 바뀐 것이 없으면 null.
 * selectedKey는 notionCalendarKey 값(비었으면 고르지 않음)이고 options에서 찾는다.
 */
export function notionCalendarSaveInput(
  current: Pick<NotionCalendarSettings, 'accountId' | 'calendarId' | 'sendInvites'> | null,
  selectedKey: string,
  options: readonly NotionCalendarOption[],
  sendInvites: boolean,
): NotionCalendarSettingsInput | null {
  const picked = options.find((o) => notionCalendarKey(o) === selectedKey);
  if (picked && (!current || notionCalendarKey(current) !== selectedKey)) return { accountId: picked.accountId, calendarId: picked.calendarId, sendInvites };
  if (current && sendInvites !== current.sendInvites) return { sendInvites };
  return null;
}

/** 화면에 보일 상위 페이지 id 표시: 대시 없는 32자리를 Notion 주소로 보여 준다 */
export function notionPageLink(pageId: string): string {
  return `https://www.notion.so/${pageId}`;
}

/** 서버가 준 외부 주소를 링크로 쓰기 전 확인: http(s)가 아니면 null (javascript: 같은 주소를 막는다) */
export function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** 연결 허용이 끝나고 돌아왔을 때 띄울 안내. 연결 대상 이름에 받침이 달라 조사를 대상마다 적는다 */
export function integrationCallbackToast(notice: IntegrationCallbackNotice): { tone: 'ok' | 'error'; text: string } {
  if (notice.result === 'connected') {
    const text =
      notice.providerKey === INTEGRATION_PROVIDER.NOTION
        ? 'Notion을 연결했어요'
        : notice.providerKey === INTEGRATION_PROVIDER.GOOGLE_DRIVE
          ? 'Google Drive를 연결했어요'
          : '연결했어요';
    return { tone: 'ok', text };
  }
  return { tone: 'error', text: notice.message ?? '연결하지 못했어요. 처음부터 다시 시도해 주세요' };
}

/** 연결 화면에서 그릴 카드 종류. 모르는 연결 대상은 null (그리지 않는다) */
export type IntegrationCardKind = 'notion' | 'google-drive';

export function integrationCardKind(connection: Pick<IntegrationConnectionView, 'providerKey'>): IntegrationCardKind | null {
  if (connection.providerKey === INTEGRATION_PROVIDER.NOTION) return 'notion';
  if (connection.providerKey === INTEGRATION_PROVIDER.GOOGLE_DRIVE) return 'google-drive';
  return null;
}

export function googleDriveConnection(integrations: readonly IntegrationConnectionView[] | undefined): IntegrationConnectionView | undefined {
  return integrations?.find((item) => item.providerKey === INTEGRATION_PROVIDER.GOOGLE_DRIVE);
}

/**
 * Drive 파일을 읽을 수 있는지: 연결되어 있고 폴더가 정해져 있을 때 (회의록·Drive 화면·AI 입력·메신저 첨부가 같이 쓴다).
 * 서비스 계정(이슈 #395)도 같다: 서버가 키를 읽으면 CONNECTED, 폴더는 .env(GOOGLE_DRIVE_FOLDER)가 먼저인 실제 폴더를 준다.
 */
export function isDriveReady(connection: IntegrationConnectionView | undefined): boolean {
  return connection?.status === 'CONNECTED' && !!connection.settings.folderId;
}

/** 회의록 만들기에서 "Drive에서 녹음 가져오기"를 보일지 */
export function canImportAudioFromDrive(connection: IntegrationConnectionView | undefined): boolean {
  return isDriveReady(connection);
}

/** 폴더 id를 Drive 주소로 보여 준다 */
export function driveFolderLink(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

/** Drive가 크기를 주지 않으면 "크기 모름" */
export function driveFileSizeLabel(size: number | null): string {
  return size === null ? '크기 모름' : fmtBytes(size);
}

/** 이 녹음을 회의록으로 가져올 수 있는지 (서버 상한 500MB). 문제가 있으면 한국어 문구 */
export function driveAudioProblem(file: Pick<DriveFileView, 'size'>): string | null {
  if (file.size !== null && file.size > MEETING_AUDIO_MAX_BYTES) return `${fmtBytes(MEETING_AUDIO_MAX_BYTES)}를 넘어서 가져올 수 없어요`;
  return null;
}

/** 서버 .env의 서비스 계정으로 Drive를 읽는지 (이슈 #395). 이때는 화면에서 연결·끊기를 하지 않는다 */
export function isDriveServiceAccount(connection: Pick<IntegrationConnectionView, 'authMode'> | undefined): boolean {
  return connection?.authMode === 'SERVICE_ACCOUNT';
}

export const DRIVE_SERVICE_ACCOUNT_NOTE = '서버 설정(.env)의 서비스 계정으로 연결돼 있어요';

/** 연결하기 단추가 막힌 이유. 막히지 않았으면 null. 저장한 값만 본다: 연결할 때 서버가 저장된 OAuth 클라이언트를 쓴다 */
export function driveConnectBlockReason(connection: IntegrationConnectionView, hasUnsavedChanges: boolean): string | null {
  if (isDriveServiceAccount(connection)) return DRIVE_SERVICE_ACCOUNT_NOTE;
  const client = connection.oauthClient;
  if (!client?.clientId || !client.clientSecretSet) return '클라이언트 ID와 보안 비밀번호를 저장한 뒤 연결할 수 있어요';
  if (hasUnsavedChanges) return '저장하지 않은 변경이 있어요. 먼저 저장해 주세요';
  return null;
}

export interface DriveSettingsDraft {
  savedClientId: string;
  clientId: string;
  clientSecret: string;
  savedFolder: string;
  folder: string;
}

/** 바뀐 칸만 담은 설정 저장 본문. 비우면 null(서버가 비운다), 보안 비밀번호는 입력했을 때만 보낸다 */
export function driveSettingsPatch(draft: DriveSettingsDraft): IntegrationSettingsInput {
  const patch: IntegrationSettingsInput = {};
  const clientId = draft.clientId.trim();
  if (clientId !== draft.savedClientId) patch.clientId = clientId || null;
  if (draft.clientSecret !== '') patch.clientSecret = draft.clientSecret.trim() || null;
  const folder = draft.folder.trim();
  if (folder !== draft.savedFolder) patch.folder = folder || null;
  return patch;
}
