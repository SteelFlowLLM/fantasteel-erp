// 외부 서비스 연결 (문서에 없는 기능, 이슈 #358, docs/backend/integration.md). 회사 계정 하나를 모든 사원이 함께 쓴다.
// 목록은 로그인한 사원 누구나 읽고(회의록 화면이 내보내기 버튼을 보일지 정한다), 설정·연결·끊기·확인은 ORG_MANAGE 사용 권한이 필요하다.
import type {
  DriveFileListKind,
  DriveFilePage,
  IntegrationConnectResult,
  IntegrationConnectionView,
  IntegrationProviderKey,
  IntegrationSettingsInput,
  IntegrationTestResult,
  NotionCalendarOption,
  NotionCalendarSettingsInput,
  NotionSyncFailureView,
  NotionSyncRetryResult,
} from '@fantasteel/shared';
import { serverDownload, serverRequest, serverUrl } from '@/api/http';
import { driveContentPath } from '@/lib/driveFiles';

export type {
  DriveFileKind,
  DriveFileListKind,
  DriveFilePage,
  DriveFileView,
  IntegrationConnectResult,
  IntegrationConnectionView,
  IntegrationFaultView,
  IntegrationHealthLevel,
  IntegrationHealthView,
  IntegrationProviderKey,
  IntegrationSettingsInput,
  IntegrationTestResult,
  NotionCalendarOption,
  NotionCalendarSettings,
  NotionCalendarSettingsInput,
  NotionSyncFailureView,
  NotionSyncRetryResult,
  NotionWorkspaceView,
} from '@fantasteel/shared';

export const integrationKeys = {
  all: ['integrations'] as const,
  list: () => ['integrations', 'list'] as const,
  syncFailures: () => ['integrations', 'sync-failures'] as const,
  driveFiles: (kind: DriveFileListKind) => ['integrations', 'drive-files', kind] as const,
  driveBlob: (fileId: string) => ['integrations', 'drive-blob', fileId] as const,
};

export const integrationApi = {
  list: (): Promise<IntegrationConnectionView[]> => serverRequest('GET', '/integrations'),
  updateSettings: ({ providerKey, input }: { providerKey: IntegrationProviderKey; input: IntegrationSettingsInput }): Promise<IntegrationConnectionView> =>
    serverRequest('PUT', `/integrations/${providerKey}/settings`, { body: input }),
  /** 돌려받은 authorizationUrl로 브라우저를 옮겨 관리자가 허용하게 한다 */
  connect: (providerKey: IntegrationProviderKey): Promise<IntegrationConnectResult> => serverRequest('POST', `/integrations/${providerKey}/connect`),
  disconnect: (providerKey: IntegrationProviderKey): Promise<IntegrationConnectionView> => serverRequest('POST', `/integrations/${providerKey}/disconnect`),
  test: (providerKey: IntegrationProviderKey): Promise<IntegrationTestResult> => serverRequest('POST', `/integrations/${providerKey}/test`),
  /** 이슈 #391. 상위 페이지 아래 일정·회의록·할 일 데이터베이스를 만들고 자동 반영을 시작한다. 이미 있으면 만들지 않는다 */
  setupNotionWorkspace: (): Promise<IntegrationConnectionView> => serverRequest('POST', '/integrations/notion/workspace'),
  /** 이슈 #391 2단계. 회사 Notion 계정에 연결된 캘린더 (없으면 빈 목록) */
  notionCalendars: (): Promise<NotionCalendarOption[]> => serverRequest('GET', '/integrations/notion/calendars'),
  /** 일정을 함께 만들 캘린더·초대 여부. accountId null이면 캘린더 반영을 끈다 */
  updateNotionCalendar: (input: NotionCalendarSettingsInput): Promise<IntegrationConnectionView> => serverRequest('PUT', '/integrations/notion/calendar', { body: input }),
  /** 이슈 #518. Notion 반영에 실패해 DB 목록에 남은 일정·회의록·할 일 (ORG_MANAGE 조회 권한) */
  notionSyncFailures: (): Promise<NotionSyncFailureView[]> => serverRequest('GET', '/integrations/notion/sync-failures'),
  /** 이슈 #518. 남은 반영 실패를 모두 다시 시도하고 결과를 기다린다 (ORG_MANAGE 사용 권한) */
  retryNotionSyncFailures: (): Promise<NotionSyncRetryResult> => serverRequest('POST', '/integrations/notion/sync-failures/retry'),
  /** 이슈 #518. 반영 실패 한 건만 다시 시도한다 */
  retryNotionSyncFailure: (failureId: number): Promise<NotionSyncRetryResult> => serverRequest('POST', `/integrations/notion/sync-failures/${failureId}/retry`),
  /** 이슈 #361·#392. 설정한 Drive 폴더의 녹음·사진·문서(kind=all은 모두), 최신 수정순 한 쪽(50개). pageToken으로 다음 쪽 */
  driveFiles: ({ kind, pageToken }: { kind: DriveFileListKind; pageToken?: string }): Promise<DriveFilePage> =>
    serverRequest('GET', '/integrations/google-drive/files', { query: { kind, pageToken } }),
  /** 파일 내용을 Blob으로 받는다 (사진·PDF 미리보기, AI 입력·메신저 첨부). Google 문서류는 PDF로 온다 */
  driveFileBlob: (fileId: string): Promise<Blob> => serverDownload(driveContentPath(fileId)),
  /** 브라우저가 바로 여는 주소 (<audio src>, 내려받기 링크). 로그인 쿠키가 같이 간다 */
  driveContentUrl: (fileId: string, options: { download?: boolean } = {}): string => serverUrl(driveContentPath(fileId, options)),
};
