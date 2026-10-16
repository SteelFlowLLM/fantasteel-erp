// 외부 연결 도우미: 상태 문구·색, 콜백 쿼리 읽기, 회의록 Notion 내보내기 버튼 조건 (이슈 #358).
import { INTEGRATION_PROVIDER, MEETING_MINUTES_STATUS, type IntegrationConnectionStatus, type IntegrationConnectionView, type IntegrationProviderKey, type MeetingMinutesView } from '@fantasteel/shared';
import { PERMISSION } from '@/codes';
import type { BadgeTone } from '@/components/Badge';
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
