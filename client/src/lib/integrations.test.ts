// 외부 연결 도우미: 상태 문구, 콜백 쿼리 읽기, Notion 내보내기 버튼 조건 (이슈 #358)
import type { IntegrationConnectionView, MeetingMinutesView } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import {
  INTEGRATION_STATUS_LABEL,
  canExportMeetingToNotion,
  isNotionExportReady,
  notionConnection,
  notionPageLink,
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
