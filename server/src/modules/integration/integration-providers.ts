import { INTEGRATION_PROVIDER, type IntegrationProtocol, type IntegrationProviderKey } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { NOTION_CREATE_PAGES_TOOL } from './notion/notion.tools';

/** Notion 공식 원격 MCP 서버 (OAuth만 받는다) */
export const NOTION_MCP_DEFAULT_URL = 'https://mcp.notion.com/mcp';

export interface IntegrationProviderPreset {
  key: IntegrationProviderKey;
  displayName: string;
  protocol: IntegrationProtocol;
  /** MCP 서버 주소. MCP가 아니면 null */
  serverUrl: string | null;
  /** 이 기능이 부르는 MCP 도구. 연결 확인에서 있는지 본다 */
  requiredTools: string[];
}

/**
 * 연결할 수 있는 대상. 행은 처음 설정·연결할 때 만든다.
 * 주소는 부를 때마다 읽는다: 테스트가 가짜 MCP 서버 주소(NOTION_MCP_URL)로 바꿔 끼운다.
 * Google Drive는 MCP가 아니라 REST API v3 + OAuth 2.0(protocol OAUTH2)이다: 서버 주소는 google-drive/google-oauth.ts의 고정 주소.
 */
export function providerPresets(): Record<IntegrationProviderKey, IntegrationProviderPreset> {
  return {
    [INTEGRATION_PROVIDER.NOTION]: {
      key: INTEGRATION_PROVIDER.NOTION,
      displayName: 'Notion',
      protocol: 'MCP',
      serverUrl: process.env.NOTION_MCP_URL || NOTION_MCP_DEFAULT_URL,
      requiredTools: [NOTION_CREATE_PAGES_TOOL],
    },
    [INTEGRATION_PROVIDER.GOOGLE_DRIVE]: {
      key: INTEGRATION_PROVIDER.GOOGLE_DRIVE,
      displayName: 'Google Drive',
      protocol: 'OAUTH2',
      serverUrl: null,
      requiredTools: [],
    },
  };
}

export function isProviderKey(key: string): key is IntegrationProviderKey {
  return Object.prototype.hasOwnProperty.call(providerPresets(), key);
}

export function providerPreset(key: string): IntegrationProviderPreset {
  if (!isProviderKey(key)) throw new AppException('INT-001');
  return providerPresets()[key];
}

/** MCP 연결만 받는 기능(MCP 클라이언트)에서 쓴다 */
export function mcpServerUrlOf(preset: IntegrationProviderPreset): string {
  if (preset.protocol !== 'MCP' || !preset.serverUrl) throw new AppException('INT-001', `${preset.displayName}은(는) MCP 연결이 아니에요`);
  return preset.serverUrl;
}
