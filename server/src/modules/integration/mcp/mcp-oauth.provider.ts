import { randomBytes } from 'node:crypto';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { oauthCallbackUrl } from '../integration-urls';
import type { IntegrationTokenStore } from '../integration-token.store';

/**
 * 백그라운드 호출(내보내기·연결 확인)에서 SDK가 브라우저 허용을 새로 시키려 함.
 * 리프레시 토큰이 거절됐을 때(SDK가 토큰을 먼저 지운다)와 갱신 요청이 일시적으로 실패했을 때(토큰이 남아 있다) 모두 난다.
 * 어느 쪽인지는 부르는 쪽이 토큰이 남았는지로 가린다.
 */
export class McpReconnectRequiredError extends Error {
  constructor() {
    super('다시 연결해야 해요');
  }
}

export type McpOAuthMode =
  /** 관리자가 연결을 시작함: 허용 화면 주소를 받아 브라우저로 넘긴다 */
  | { kind: 'interactive'; state: string }
  /** 콜백에서 인가 코드를 토큰으로 바꾸거나, 저장된 토큰으로 도구를 부름 */
  | { kind: 'background' };

/**
 * MCP SDK의 OAuth 공급자를 DB(암호화)에 붙인다. 회사 계정 하나라 "세션"은 연결 대상(providerKey) 하나다.
 * 서버가 대신 부르는 것이라 브라우저 이동은 직접 하지 않고, 허용 화면 주소를 담아 두었다가 API 응답으로 돌려준다.
 */
export class McpOAuthProvider implements OAuthClientProvider {
  /** interactive에서 SDK가 넘긴 허용 화면 주소 */
  authorizationUrl: URL | null = null;

  constructor(
    private readonly store: IntegrationTokenStore,
    private readonly providerKey: string,
    private readonly mode: McpOAuthMode,
  ) {}

  get redirectUrl(): string {
    return oauthCallbackUrl();
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'FantaSteel ERP',
      redirect_uris: [oauthCallbackUrl()],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // 비밀값을 받지 않는 공개 클라이언트로 등록하고 PKCE로 지킨다 (서버가 비밀값을 주면 SDK가 그것을 쓴다)
      token_endpoint_auth_method: 'none',
    };
  }

  state(): string {
    return this.mode.kind === 'interactive' ? this.mode.state : randomBytes(16).toString('base64url');
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const info = await this.store.readClientInformation<OAuthClientInformationMixed>(this.providerKey);
    // 서버 주소(SERVER_PUBLIC_URL)가 바뀌면 옛 redirect URI로 등록한 클라이언트는 쓸 수 없어 다시 등록한다
    const registered = info && 'redirect_uris' in info ? info.redirect_uris : undefined;
    if (registered && !registered.includes(oauthCallbackUrl())) return undefined;
    return info;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    await this.store.saveClientInformation(this.providerKey, info);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    // 연결 시작에서는 옛 토큰을 없는 것처럼 보여 SDK가 갱신 대신 허용 화면으로 가게 한다. 옛 토큰은 새 토큰을 받을 때까지 그대로 쓴다
    if (this.mode.kind === 'interactive') return undefined;
    return this.store.readTokens<OAuthTokens>(this.providerKey);
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.store.saveTokens(this.providerKey, tokens);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    if (this.mode.kind !== 'interactive') throw new McpReconnectRequiredError();
    this.authorizationUrl = authorizationUrl;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    // 백그라운드 호출이 연결 중인 관리자의 code verifier를 덮어쓰면 그 콜백이 실패한다
    if (this.mode.kind !== 'interactive') return;
    await this.store.saveCodeVerifier(this.providerKey, codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    const verifier = await this.store.readCodeVerifier(this.providerKey);
    if (!verifier) throw new McpReconnectRequiredError();
    return verifier;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'discovery') return;
    if (this.mode.kind === 'interactive') {
      // 연결 시작이 실패해도 지금 쓰는 토큰은 남긴다 (새 허용이 끝나야 바꾼다)
      if (scope === 'tokens') return;
      if (scope === 'all') {
        await this.store.clear(this.providerKey, 'client');
        await this.store.clear(this.providerKey, 'verifier');
        return;
      }
    }
    await this.store.clear(this.providerKey, scope);
  }
}
