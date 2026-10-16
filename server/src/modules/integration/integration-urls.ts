import type { IntegrationCallbackResult } from '@fantasteel/shared';

/** 콜백이 끝나고 브라우저를 돌려보낼 화면 (관리 > 외부 연결) */
const CLIENT_SETTINGS_PATH = '/admin/integrations';

function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * 브라우저가 이 서버에 닿는 주소 (`…/api/v1`). OAuth 서버에 등록하는 redirect URI가 이것으로 만들어지므로
 * 프록시·다른 포트 뒤에서 돌릴 때는 SERVER_PUBLIC_URL을 꼭 넣는다.
 */
export function serverPublicUrl(): string {
  return trimSlash(process.env.SERVER_PUBLIC_URL || `http://localhost:${process.env.API_PORT ?? 8787}/api/v1`);
}

/** 모든 연결 대상이 함께 쓰는 OAuth 콜백. 어느 연결인지는 state로 찾는다 */
export function oauthCallbackUrl(): string {
  return `${serverPublicUrl()}/integrations/oauth/callback`;
}

/** 화면 주소. 없으면 CORS_ORIGIN의 첫 주소, 그것도 없으면 개발 화면 기본 주소 */
export function clientBaseUrl(): string {
  const fromCors = process.env.CORS_ORIGIN?.split(',')[0];
  return trimSlash(process.env.CLIENT_BASE_URL || fromCors || 'http://localhost:5173');
}

export function clientReturnUrl(providerKey: string | null, result: IntegrationCallbackResult, message?: string): string {
  const url = new URL(`${clientBaseUrl()}${CLIENT_SETTINGS_PATH}`);
  if (providerKey) url.searchParams.set('integration', providerKey);
  url.searchParams.set('result', result);
  if (message) url.searchParams.set('message', message);
  return url.toString();
}
