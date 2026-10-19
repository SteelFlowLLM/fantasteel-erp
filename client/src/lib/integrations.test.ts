// 외부 연결 도우미: 상태 문구, 콜백 쿼리 읽기, Notion 내보내기 버튼 조건 (이슈 #358), Notion 업무 공간 (이슈 #391)
import type { IntegrationConnectionView, MeetingMinutesView, NotionWorkspaceView } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import {
  INTEGRATION_STATUS_LABEL,
  canExportMeetingToNotion,
  canImportAudioFromDrive,
  driveAudioProblem,
  driveConnectBlockReason,
  driveFileSizeLabel,
  driveFolderLink,
  driveSettingsPatch,
  googleDriveConnection,
  integrationCallbackToast,
  integrationCardKind,
  isNotionExportReady,
  notionConnection,
  notionCalendarKey,
  notionCalendarLabel,
  notionCalendarSaveInput,
  notionPageLink,
  notionWorkspaceBlockReason,
  notionWorkspaceStatusLabel,
  notionWorkspaceSyncLabel,
  parseIntegrationCallback,
  safeExternalUrl,
  withoutCallbackParams,
} from '@/lib/integrations';

const PAGE_ID = '0123456789abcdef0123456789abcdef';

const connection = (overrides: Partial<IntegrationConnectionView> = {}): IntegrationConnectionView => ({
  providerKey: 'notion',
  displayName: 'Notion',
  protocol: 'MCP',
  serverUrl: 'https://mcp.notion.com/mcp',
  status: 'CONNECTED',
  connectedAt: '2026-10-16T01:00:00.000Z',
  connectedBy: { id: 1, name: '관리자' },
  lastError: null,
  settings: { parentPageId: PAGE_ID },
  redirectUri: null,
  oauthClient: null,
  notionWorkspace: null,
  ...overrides,
});

const minutes = (overrides: Partial<Pick<MeetingMinutesView, 'meetingMinutesStatus' | 'notionPageUrl' | 'creator'>> = {}) => ({
  meetingMinutesStatus: 'CONFIRMED' as const,
  notionPageUrl: null,
  creator: { id: 7, name: '작성자' },
  ...overrides,
});

const author = { employeeId: 7, permissions: {} };
const admin = { employeeId: 1, permissions: { ORG_MANAGE: 'USE' as const } };
const viewer = { employeeId: 2, permissions: { ORG_MANAGE: 'VIEW' as const } };

describe('상태 문구', () => {
  it('세 상태 모두 한국어 문구가 있다', () => {
    expect(INTEGRATION_STATUS_LABEL).toEqual({ CONNECTED: '연결됨', RECONNECT_REQUIRED: '다시 연결 필요', NOT_CONNECTED: '연결 안 됨' });
  });
});

describe('parseIntegrationCallback', () => {
  const parse = (query: string) => parseIntegrationCallback(new URLSearchParams(query));

  it('연결 성공', () => {
    expect(parse('integration=notion&result=connected')).toEqual({ providerKey: 'notion', result: 'connected', message: null });
  });

  it('실패는 서버 문구를 담는다', () => {
    expect(parse('integration=notion&result=error&message=%EA%B1%B0%EC%A0%88')).toEqual({ providerKey: 'notion', result: 'error', message: '거절' });
  });

  it('모르는 연결 대상은 providerKey가 null', () => {
    expect(parse('integration=slack&result=connected')?.providerKey).toBeNull();
  });

  it('result가 없거나 모르는 값이면 일반 방문으로 본다', () => {
    expect(parse('')).toBeNull();
    expect(parse('integration=notion')).toBeNull();
    expect(parse('result=weird')).toBeNull();
  });
});

describe('withoutCallbackParams', () => {
  it('콜백 쿼리만 지우고 나머지는 남긴다', () => {
    expect(withoutCallbackParams('integration=notion&result=error&message=x&tab=a')).toBe('tab=a');
    expect(withoutCallbackParams('integration=notion&result=connected')).toBe('');
  });
});

describe('Notion 연결 준비', () => {
  it('목록에서 Notion 항목을 찾는다', () => {
    expect(notionConnection([connection()])?.providerKey).toBe('notion');
    expect(notionConnection(undefined)).toBeUndefined();
  });

  it('연결됨 + 상위 페이지가 있어야 준비됨', () => {
    expect(isNotionExportReady(connection())).toBe(true);
    expect(isNotionExportReady(connection({ settings: { parentPageId: null } }))).toBe(false);
    expect(isNotionExportReady(connection({ settings: {} }))).toBe(false);
    expect(isNotionExportReady(connection({ status: 'RECONNECT_REQUIRED' }))).toBe(false);
    expect(isNotionExportReady(connection({ status: 'NOT_CONNECTED' }))).toBe(false);
    expect(isNotionExportReady(undefined)).toBe(false);
  });

  it('상위 페이지 id를 Notion 주소로 보여 준다', () => {
    expect(notionPageLink(PAGE_ID)).toBe(`https://www.notion.so/${PAGE_ID}`);
  });
});

describe('canExportMeetingToNotion', () => {
  it('작성자와 ORG_MANAGE 사용 권한자는 내보낼 수 있다', () => {
    expect(canExportMeetingToNotion(minutes(), author, connection())).toBe(true);
    expect(canExportMeetingToNotion(minutes(), admin, connection())).toBe(true);
  });

  it('작성자도 아니고 조회 권한뿐이면 못 내보낸다', () => {
    expect(canExportMeetingToNotion(minutes(), viewer, connection())).toBe(false);
  });

  it('확정 전에는 못 내보낸다', () => {
    expect(canExportMeetingToNotion(minutes({ meetingMinutesStatus: 'REVIEW' }), author, connection())).toBe(false);
  });

  it('이미 내보냈으면 버튼을 보이지 않는다', () => {
    expect(canExportMeetingToNotion(minutes({ notionPageUrl: 'https://www.notion.so/x' }), author, connection())).toBe(false);
  });

  it('연결이 안 됐거나 상위 페이지가 없으면 못 내보낸다', () => {
    expect(canExportMeetingToNotion(minutes(), author, connection({ status: 'NOT_CONNECTED' }))).toBe(false);
    expect(canExportMeetingToNotion(minutes(), author, connection({ status: 'RECONNECT_REQUIRED' }))).toBe(false);
    expect(canExportMeetingToNotion(minutes(), author, connection({ settings: { parentPageId: null } }))).toBe(false);
    expect(canExportMeetingToNotion(minutes(), author, undefined)).toBe(false);
  });
});

describe('safeExternalUrl', () => {
  it('http(s)만 링크로 쓴다', () => {
    expect(safeExternalUrl('https://www.notion.so/abc')).toBe('https://www.notion.so/abc');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('not a url')).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
});

const drive = (overrides: Partial<IntegrationConnectionView> = {}): IntegrationConnectionView =>
  connection({
    providerKey: 'google-drive',
    displayName: 'Google Drive',
    protocol: 'OAUTH2',
    serverUrl: null,
    settings: { folderId: 'folderId1234567' },
    redirectUri: 'http://localhost:8787/api/v1/integrations/oauth/callback',
    oauthClient: { clientId: 'abc.apps.googleusercontent.com', clientSecretSet: true },
    ...overrides,
  });

describe('integrationCallbackToast', () => {
  const notice = (providerKey: 'notion' | 'google-drive' | null, result: 'connected' | 'error', message: string | null = null) => ({ providerKey, result, message });

  it('연결 대상 이름을 맞춰 알린다', () => {
    expect(integrationCallbackToast(notice('notion', 'connected'))).toEqual({ tone: 'ok', text: 'Notion을 연결했어요' });
    expect(integrationCallbackToast(notice('google-drive', 'connected'))).toEqual({ tone: 'ok', text: 'Google Drive를 연결했어요' });
    expect(integrationCallbackToast(notice(null, 'connected')).text).toBe('연결했어요');
  });

  it('실패는 서버 문구를 그대로, 없으면 기본 문구', () => {
    expect(integrationCallbackToast(notice('google-drive', 'error', 'client id·secret을 확인해 주세요'))).toEqual({ tone: 'error', text: 'client id·secret을 확인해 주세요' });
    expect(integrationCallbackToast(notice('notion', 'error')).tone).toBe('error');
  });
});

describe('integrationCardKind', () => {
  it('연결 대상마다 카드를 고르고 모르는 대상은 그리지 않는다', () => {
    expect(integrationCardKind({ providerKey: 'notion' })).toBe('notion');
    expect(integrationCardKind({ providerKey: 'google-drive' })).toBe('google-drive');
    expect(integrationCardKind({ providerKey: 'slack' as 'notion' })).toBeNull();
  });
});

describe('Google Drive 녹음 가져오기 조건', () => {
  it('연결됨 + 폴더가 있어야 보인다', () => {
    expect(googleDriveConnection([connection(), drive()])?.providerKey).toBe('google-drive');
    expect(googleDriveConnection(undefined)).toBeUndefined();
    expect(canImportAudioFromDrive(drive())).toBe(true);
    expect(canImportAudioFromDrive(drive({ settings: { folderId: null } }))).toBe(false);
    expect(canImportAudioFromDrive(drive({ settings: {} }))).toBe(false);
    expect(canImportAudioFromDrive(drive({ status: 'RECONNECT_REQUIRED' }))).toBe(false);
    expect(canImportAudioFromDrive(drive({ status: 'NOT_CONNECTED' }))).toBe(false);
    expect(canImportAudioFromDrive(undefined)).toBe(false);
  });

  it('폴더 id를 Drive 주소로 보여 준다', () => {
    expect(driveFolderLink('abc_123')).toBe('https://drive.google.com/drive/folders/abc_123');
  });
});

describe('Drive 파일 크기·가져오기 문제', () => {
  it('크기를 읽기 쉽게, 없으면 크기 모름', () => {
    expect(driveFileSizeLabel(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(driveFileSizeLabel(2048)).toBe('2.0 KB');
    expect(driveFileSizeLabel(null)).toBe('크기 모름');
  });

  it('500MB를 넘는 녹음만 막는다', () => {
    expect(driveAudioProblem({ size: 500 * 1024 * 1024 })).toBeNull();
    expect(driveAudioProblem({ size: null })).toBeNull();
    expect(driveAudioProblem({ size: 500 * 1024 * 1024 + 1 })).toContain('500.0 MB');
  });
});

describe('driveConnectBlockReason', () => {
  it('클라이언트 ID·보안 비밀번호가 저장돼야 연결할 수 있다', () => {
    expect(driveConnectBlockReason(drive(), false)).toBeNull();
    expect(driveConnectBlockReason(drive({ oauthClient: { clientId: null, clientSecretSet: true } }), false)).toContain('저장한 뒤');
    expect(driveConnectBlockReason(drive({ oauthClient: { clientId: 'a.apps.googleusercontent.com', clientSecretSet: false } }), false)).toContain('저장한 뒤');
    expect(driveConnectBlockReason(drive({ oauthClient: null }), false)).toContain('저장한 뒤');
  });

  it('저장하지 않은 변경이 있으면 먼저 저장하게 한다', () => {
    expect(driveConnectBlockReason(drive(), true)).toContain('먼저 저장');
  });
});

describe('driveSettingsPatch', () => {
  const base = { savedClientId: 'a.apps.googleusercontent.com', clientId: 'a.apps.googleusercontent.com', clientSecret: '', savedFolder: 'https://drive.google.com/drive/folders/f1', folder: 'https://drive.google.com/drive/folders/f1' };

  it('바뀐 칸만 보낸다', () => {
    expect(driveSettingsPatch(base)).toEqual({});
    expect(driveSettingsPatch({ ...base, clientSecret: ' s3cret ' })).toEqual({ clientSecret: 's3cret' });
    expect(driveSettingsPatch({ ...base, folder: ' https://drive.google.com/drive/folders/f2 ' })).toEqual({ folder: 'https://drive.google.com/drive/folders/f2' });
    expect(driveSettingsPatch({ ...base, clientId: 'b.apps.googleusercontent.com' })).toEqual({ clientId: 'b.apps.googleusercontent.com' });
  });

  it('칸을 비우면 null로 보내 서버가 비우게 한다', () => {
    expect(driveSettingsPatch({ ...base, clientId: '  ', folder: '' })).toEqual({ clientId: null, folder: null });
  });
});

describe('Notion 업무 공간', () => {
  const workspace = (overrides: Partial<NotionWorkspaceView> = {}): NotionWorkspaceView => ({
    ready: true,
    createdAt: '2026-10-19T01:00:00.000Z',
    databases: [
      { key: 'scheduleEvents', title: 'ERP 일정', url: 'https://www.notion.so/a' },
      { key: 'meetingMinutes', title: 'ERP 회의록', url: 'https://www.notion.so/b' },
      { key: 'tasks', title: 'ERP 할 일', url: 'https://www.notion.so/c' },
    ],
    lastSyncedAt: null,
    failedCount: 0,
    pendingCount: 0,
    lastSyncError: null,
    setupWarning: null,
    calendar: null,
    ...overrides,
  });

  it('만들기는 연결·저장한 상위 페이지가 있고 고치던 값이 없을 때만', () => {
    expect(notionWorkspaceBlockReason(connection(), false)).toBeNull();
    expect(notionWorkspaceBlockReason(connection({ status: 'RECONNECT_REQUIRED' }), false)).toContain('연결한 뒤');
    expect(notionWorkspaceBlockReason(connection({ settings: { parentPageId: null } }), false)).toContain('상위 페이지를 저장한 뒤');
    expect(notionWorkspaceBlockReason(connection(), true)).toContain('먼저 저장');
  });

  it('상태 문구: 안 만듦 · 일부만 · 자동 반영', () => {
    expect(notionWorkspaceStatusLabel(null)).toBe('아직 만들지 않았어요');
    expect(notionWorkspaceStatusLabel(workspace({ ready: false, databases: workspace().databases.slice(0, 1) }))).toBe('일부만 만들었어요 (1/3)');
    expect(notionWorkspaceStatusLabel(workspace())).toBe('자동으로 반영하고 있어요');
  });

  it('반영 문구: 기다림·실패 수', () => {
    expect(notionWorkspaceSyncLabel(workspace())).toBe('모두 반영했어요');
    expect(notionWorkspaceSyncLabel(workspace({ pendingCount: 3, failedCount: 1 }))).toBe('3건 기다리는 중 · 1건 실패(잠시 뒤 다시)');
    expect(notionWorkspaceSyncLabel(workspace({ pendingCount: 0, failedCount: 2 }))).toBe('2건 실패(잠시 뒤 다시)');
  });
});

describe('Notion 캘린더 고르기 (이슈 #391 2단계)', () => {
  const erp = { accountId: 'acc-1', accountEmail: 'erp@company.com', calendarId: 'erp-cal', name: 'ERP', primary: true, writable: true };
  const holiday = { accountId: 'acc-1', accountEmail: null, calendarId: 'holiday|kr', name: '휴일', primary: false, writable: false };

  it('고르기 값은 계정·캘린더를 인코딩해 겹치지 않는다', () => {
    expect(notionCalendarKey(holiday)).toBe('acc-1|holiday%7Ckr');
    expect(notionCalendarKey({ accountId: 'a|b', calendarId: 'c' })).not.toBe(notionCalendarKey({ accountId: 'a', calendarId: 'b|c' }));
  });

  it('한 줄: 이름 · 계정 메일, 읽기 전용 표시', () => {
    expect(notionCalendarLabel(erp)).toBe('ERP · erp@company.com');
    expect(notionCalendarLabel(holiday)).toBe('휴일 (읽기 전용)');
  });

  it('저장 본문: 새로 고르면 계정·캘린더·초대, 초대만 바꾸면 초대만, 바뀐 것이 없으면 null', () => {
    const current = { accountId: 'acc-1', calendarId: 'erp-cal', sendInvites: false };
    expect(notionCalendarSaveInput(null, notionCalendarKey(erp), [erp, holiday], false)).toEqual({ accountId: 'acc-1', calendarId: 'erp-cal', sendInvites: false });
    expect(notionCalendarSaveInput(current, notionCalendarKey(holiday), [erp, holiday], true)).toEqual({ accountId: 'acc-1', calendarId: 'holiday|kr', sendInvites: true });
    expect(notionCalendarSaveInput(current, notionCalendarKey(erp), [erp], true)).toEqual({ sendInvites: true });
    expect(notionCalendarSaveInput(current, '', [], true)).toEqual({ sendInvites: true });
    expect(notionCalendarSaveInput(current, notionCalendarKey(erp), [erp], false)).toBeNull();
    expect(notionCalendarSaveInput(null, '', [], true)).toBeNull();
  });
});
