// 외부 연결 도우미: 상태 문구·색, 콜백 쿼리 읽기, 회의록 Notion 내보내기 버튼 조건 (이슈 #358), Google Drive 카드·녹음 가져오기 조건 (이슈 #361).
import { INTEGRATION_PROVIDER, MEETING_AUDIO_MAX_BYTES, MEETING_MINUTES_STATUS, type DriveFileView, type IntegrationConnectionStatus, type IntegrationConnectionView, type IntegrationProviderKey, type IntegrationSettingsInput, type MeetingMinutesView } from '@fantasteel/shared';
import { PERMISSION } from '@/codes';
import type { BadgeTone } from '@/components/Badge';
import { fmtBytes } from '@/lib/format';
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

/** 화면에 보일 연결 대상 이름 */
export const INTEGRATION_PROVIDER_LABEL: Record<IntegrationProviderKey, string> = {
  [INTEGRATION_PROVIDER.NOTION]: 'Notion',
  [INTEGRATION_PROVIDER.GOOGLE_DRIVE]: 'Google Drive',
};

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
