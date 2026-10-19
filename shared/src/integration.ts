// 외부 서비스 연결 API 응답·입력 타입 (docs/backend/integration.md, 이슈 #358).
// 회사 계정 하나로 연결하고 모든 사원이 함께 쓴다. Notion은 원격 MCP 서버, Google Drive(이슈 #361)는 REST API v3 + OAuth 2.0.

/** 연결 대상 키. 서버 코드의 프리셋 키이며 공통 코드가 아니다 */
export const INTEGRATION_PROVIDER = {
  NOTION: 'notion',
  GOOGLE_DRIVE: 'google-drive',
} as const;
export type IntegrationProviderKey = (typeof INTEGRATION_PROVIDER)[keyof typeof INTEGRATION_PROVIDER];

/** MCP: 원격 MCP 서버(OAuth 동적 등록 + PKCE). OAUTH2: REST API + 관리자가 넣은 OAuth 클라이언트 */
export type IntegrationProtocol = 'MCP' | 'OAUTH2';

/**
 * NOT_CONNECTED: 연결한 적이 없거나 관리자가 끊었다.
 * CONNECTED: 토큰이 있다 (실제로 되는지는 연결 확인으로 본다).
 * RECONNECT_REQUIRED: 토큰이 만료·취소돼 관리자가 다시 연결해야 한다.
 */
export type IntegrationConnectionStatus = 'NOT_CONNECTED' | 'CONNECTED' | 'RECONNECT_REQUIRED';

/** Notion 업무 공간의 데이터베이스 종류 (이슈 #391). ERP 표 하나가 Notion 데이터베이스 하나로 간다 */
export const NOTION_WORKSPACE_DATABASES = ['scheduleEvents', 'meetingMinutes', 'tasks'] as const;
export type NotionWorkspaceDatabaseKey = (typeof NOTION_WORKSPACE_DATABASES)[number];

/** 만든 Notion 데이터베이스 하나. 페이지는 dataSourceId 아래에 만든다 */
export interface NotionDatabaseRef {
  /** 데이터베이스 id (32자리 16진수). 만들기 결과에서 읽지 못하면 null: 데이터 소스를 읽어 찾은 뒤 보기를 만든다 */
  databaseId: string | null;
  /** 데이터 소스 id (UUID) */
  dataSourceId: string;
  url: string | null;
  /** 이 데이터베이스에 만든 보기 이름. 빠진 보기만 다시 만든다 */
  views?: string[];
}

/** Notion 캘린더에서 고른 캘린더 (이슈 #391 2단계). 일정 데이터베이스와 함께 이 캘린더에도 일정을 만든다 */
export interface NotionCalendarSettings {
  accountId: string;
  calendarId: string;
  name: string;
  /** 캘린더가 속한 계정의 메일 (목록에 있으면) */
  accountEmail: string | null;
  /** 켜면 일정 참석자 중 메일이 있는 사원을 초대한다 (초대 메일이 간다). 기본 꺼짐 */
  sendInvites: boolean;
}

/** GET integrations/notion/calendars 한 줄: 회사 Notion 계정에 연결된 캘린더 */
export interface NotionCalendarOption {
  accountId: string;
  accountEmail: string | null;
  calendarId: string;
  name: string;
  primary: boolean;
  /** 일정을 만들 수 있는지. Notion이 알려 주지 않으면 null */
  writable: boolean | null;
}

/**
 * PUT integrations/notion/calendar. accountId·calendarId를 주면 그 캘린더로 바꾸고, accountId가 null이면 캘린더 반영을 끈다.
 * sendInvites만 주면 초대 여부만 바꾼다.
 */
export interface NotionCalendarSettingsInput {
  accountId?: string | null;
  calendarId?: string;
  sendInvites?: boolean;
}

/** 서버만 쓰는 설정: 상위 페이지 아래에 만든 데이터베이스. 만든 것만 칸이 있다 (만들다 멈추면 다음에 없는 것만 만든다) */
export interface NotionWorkspaceSettings {
  scheduleEvents?: NotionDatabaseRef;
  meetingMinutes?: NotionDatabaseRef;
  tasks?: NotionDatabaseRef;
  /** 세 데이터베이스를 모두 만든 시각 */
  createdAt?: string;
  /** 일정을 함께 만들 Notion 캘린더. 없으면 캘린더에는 반영하지 않는다 */
  calendar?: NotionCalendarSettings;
}

/** 연결별 설정. 연결 대상마다 쓰는 칸이 다르다 */
export interface IntegrationSettings {
  /** Notion: 회의록 페이지를 만들 상위 페이지 id (32자리 16진수, 대시 없음) */
  parentPageId?: string | null;
  /** Notion: 업무 공간 데이터베이스 (이슈 #391). 목록 응답에는 notionWorkspace로 따로 보인다 */
  notionWorkspace?: NotionWorkspaceSettings;
  /** Google Drive: 팀이 녹음·사진을 올리는 폴더 id */
  folderId?: string | null;
}

/**
 * 연결 방법. OAUTH: 관리자가 화면에서 허용한 토큰(DB 암호문).
 * SERVICE_ACCOUNT: Google Drive만. 서버 .env의 서비스 계정 키로 토큰을 받아 로그인·다시 연결이 없다 (이슈 #395).
 */
export type IntegrationAuthMode = 'OAUTH' | 'SERVICE_ACCOUNT';

/** 관리 화면에 보이는 Notion 업무 공간 상태 (이슈 #391). ERP → Notion 한 방향으로만 반영한다 */
export interface NotionWorkspaceView {
  /** 세 데이터베이스를 모두 만들었는지. 만든 뒤부터 자동 반영한다 */
  ready: boolean;
  createdAt: string | null;
  databases: { key: NotionWorkspaceDatabaseKey; title: string; url: string | null }[];
  /** 마지막으로 반영을 끝낸 시각 (서버를 다시 띄우면 비어 있다) */
  lastSyncedAt: string | null;
  /** 반영에 실패해 잠시 뒤 다시 할 행 수 */
  failedCount: number;
  /** 반영을 기다리는 행 수 (실패한 행 포함) */
  pendingCount: number;
  /** 마지막 반영 실패 이유 */
  lastSyncError: string | null;
  /** 데이터베이스 주소를 찾지 못했거나 보기를 만들지 못했을 때 안내 (반영은 된다) */
  setupWarning: string | null;
  /** 일정을 함께 만드는 Notion 캘린더. 고르지 않았으면 null */
  calendar: NotionCalendarSettings | null;
}

/** OAUTH2 연결에 관리자가 넣은 OAuth 클라이언트. client secret은 돌려주지 않고 넣었는지만 알린다 */
export interface IntegrationOAuthClientView {
  clientId: string | null;
  clientSecretSet: boolean;
}

/** GET integrations 한 줄. 토큰·클라이언트 정보 같은 비밀값은 담지 않는다 */
export interface IntegrationConnectionView {
  providerKey: IntegrationProviderKey;
  displayName: string;
  protocol: IntegrationProtocol;
  /** MCP 서버 주소. MCP가 아니면 null */
  serverUrl: string | null;
  status: IntegrationConnectionStatus;
  connectedAt: string | null;
  connectedBy: { id: number; name: string } | null;
  /** 마지막 실패 이유 */
  lastError: string | null;
  settings: IntegrationSettings;
  /** OAUTH2: 관리자가 OAuth 클라이언트(예: Google Cloud Console)에 등록할 redirect URI. MCP는 동적 등록이라 null */
  redirectUri: string | null;
  /** OAUTH2: 관리자가 넣은 OAuth 클라이언트. MCP는 null */
  oauthClient: IntegrationOAuthClientView | null;
  /** SERVICE_ACCOUNT면 화면의 연결·끊기를 쓰지 않는다 (서버 설정이 정한다) */
  authMode: IntegrationAuthMode;
  /** SERVICE_ACCOUNT: Drive 폴더를 공유할 서비스 계정 메일. 키를 읽지 못했거나 OAUTH면 null */
  serviceAccountEmail: string | null;
  /** Google Drive: 폴더를 서버 설정(GOOGLE_DRIVE_FOLDER)이 정해 화면의 폴더 설정을 쓰지 않는다. settings.folderId는 실제로 읽는 폴더다 */
  driveFolderFromEnv: boolean;
  /** Notion: 업무 공간 상태. 만든 적이 없거나 Notion이 아니면 null */
  notionWorkspace: NotionWorkspaceView | null;
}

/** PUT integrations/:providerKey/settings */
export interface IntegrationSettingsInput {
  /** Notion: 상위 페이지 주소나 id. null이면 비운다 */
  parentPage?: string | null;
  /** Google Drive: OAuth 클라이언트 id (…apps.googleusercontent.com). null이면 비운다 */
  clientId?: string | null;
  /** Google Drive: OAuth client secret. 저장만 하고 돌려주지 않는다. null이면 비운다 */
  clientSecret?: string | null;
  /** Google Drive: 녹음·사진 폴더 주소나 id. null이면 비운다 */
  folder?: string | null;
}

/** POST integrations/:providerKey/connect. 브라우저를 이 주소로 보내 관리자가 허용하게 한다 */
export interface IntegrationConnectResult {
  authorizationUrl: string;
}

/** POST integrations/:providerKey/test. 실패도 오류가 아니라 결과로 돌려준다 */
export interface IntegrationTestResult {
  ok: boolean;
  latencyMs: number | null;
  /** MCP 서버가 알려 준 도구 이름 */
  tools: string[];
  /** 이 기능에 필요한데 서버에 없는 도구 */
  missingTools: string[];
  error: string | null;
  /** Google Drive: 설정한 폴더와 그 안의 녹음·사진 수. MCP 연결이나 실패면 null */
  driveFolder: IntegrationDriveFolderSummary | null;
}

export interface IntegrationDriveFolderSummary {
  id: string;
  name: string;
  audioCount: number;
  imageCount: number;
  /** 파일이 많아 앞의 일부(1,000개)만 셌다 */
  countLimited: boolean;
}

/** 파일 한 개의 종류. document는 PDF·Google 문서(PDF로 내보냄)·Office 파일 */
export type DriveFileKind = 'audio' | 'image' | 'document';

export const DRIVE_FILE_KINDS: readonly DriveFileKind[] = ['audio', 'image', 'document'];

/** GET integrations/google-drive/files?kind= . all은 지원하는 모든 종류 */
export type DriveFileListKind = DriveFileKind | 'all';

export const DRIVE_FILE_LIST_KINDS: readonly DriveFileListKind[] = [...DRIVE_FILE_KINDS, 'all'];

/** Drive 사진 파일 한 개의 최대 크기 (녹음은 회의 음성 상한 MEETING_AUDIO_MAX_BYTES) */
export const DRIVE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/** Drive 문서(PDF·Office) 파일 한 개의 최대 크기 */
export const DRIVE_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

/** Google 문서·스프레드시트·프레젠테이션을 PDF로 내보낼 때의 최대 크기. Drive files.export 자체의 상한(10MB)이다 */
export const DRIVE_EXPORT_MAX_BYTES = 10 * 1024 * 1024;

/** 설정한 Drive 폴더 안의 파일 한 개 */
export interface DriveFileView {
  id: string;
  name: string;
  mimeType: string;
  /** 종류. 목록에는 지원하는 종류만 나온다 */
  kind: DriveFileKind;
  /** 바이트. Drive가 크기를 주지 않으면 null */
  size: number | null;
  modifiedTime: string | null;
  /** Drive가 준 미리보기 주소 (몇 시간 뒤 만료). 없으면 null */
  thumbnailLink: string | null;
}

/** 최신 수정순 한 쪽. nextPageToken이 있으면 그 값으로 다음 쪽을 읽는다 */
export interface DriveFilePage {
  files: DriveFileView[];
  nextPageToken: string | null;
}

/**
 * OAuth 콜백이 끝나고 브라우저를 돌려보내는 화면 주소의 쿼리.
 *   /admin/integrations?integration=notion&result=connected
 *   /admin/integrations?integration=notion&result=error&message=...
 */
export type IntegrationCallbackResult = 'connected' | 'error';

