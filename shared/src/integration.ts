// 외부 서비스 연결 API 응답·입력 타입 (docs/backend/integration.md, 이슈 #358).
// 회사 계정 하나로 연결하고 모든 사원이 함께 쓴다. Notion은 원격 MCP 서버, 나중의 Google Drive는 REST API + OAuth 2.0.

/** 연결 대상 키. 서버 코드의 프리셋 키이며 공통 코드가 아니다 */
export const INTEGRATION_PROVIDER = {
  NOTION: 'notion',
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

/** 연결별 설정. 연결 대상마다 쓰는 칸이 다르다 */
export interface IntegrationSettings {
  /** Notion: 회의록 페이지를 만들 상위 페이지 id (32자리 16진수, 대시 없음) */
  parentPageId?: string | null;
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
}

/** PUT integrations/:providerKey/settings */
export interface IntegrationSettingsInput {
  /** Notion: 상위 페이지 주소나 id. null이면 비운다 */
  parentPage?: string | null;
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
}

/**
 * OAuth 콜백이 끝나고 브라우저를 돌려보내는 화면 주소의 쿼리.
 *   /admin/integrations?integration=notion&result=connected
 *   /admin/integrations?integration=notion&result=error&message=...
 */
export type IntegrationCallbackResult = 'connected' | 'error';

