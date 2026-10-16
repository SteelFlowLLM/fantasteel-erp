import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConnectionRepository } from './integration-connection.repository';
import { IntegrationCrypto, IntegrationDecryptError } from './integration-crypto';

export type IntegrationCredentialScope = 'all' | 'client' | 'tokens' | 'verifier';

/** last_error 칸 길이. 외부 서버 문구를 그대로 담으므로 자른다 */
const LAST_ERROR_MAX = 500;

/**
 * 연결 대상별 OAuth 비밀값(클라이언트 정보·토큰·code verifier)을 암호화해 읽고 쓴다.
 * MCP OAuth 공급자와 이후 REST API + OAuth 2.0 연결(Google Drive)이 함께 쓴다. 값의 모양은 부르는 쪽이 정한다.
 * 행이 없으면 읽기는 undefined, 쓰기는 행을 만들지 않고 실패한다(연결 시작 때 행을 만든다).
 */
@Injectable()
export class IntegrationTokenStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: IntegrationConnectionRepository,
    private readonly crypto: IntegrationCrypto,
  ) {}

  /** 토큰이 있는지, 없다면 한 번 연결했다가 끊긴 것인지(다시 연결 필요) */
  async connectionState(providerKey: string): Promise<{ hasTokens: boolean; wasConnected: boolean }> {
    const row = await this.repository.findByProviderKey(this.prisma, providerKey);
    return { hasTokens: Boolean(row?.oauthTokens), wasConnected: Boolean(row?.connectedAt) };
  }

  async readClientInformation<T>(providerKey: string): Promise<T | undefined> {
    const row = await this.repository.findByProviderKey(this.prisma, providerKey);
    return this.open<T>(row?.oauthClientInformation);
  }

  async saveClientInformation(providerKey: string, value: unknown): Promise<void> {
    await this.repository.update(this.prisma, providerKey, { oauthClientInformation: this.crypto.encryptJson(value) });
  }

  async readTokens<T>(providerKey: string): Promise<T | undefined> {
    const row = await this.repository.findByProviderKey(this.prisma, providerKey);
    return this.open<T>(row?.oauthTokens);
  }

  async saveTokens(providerKey: string, value: unknown): Promise<void> {
    await this.repository.update(this.prisma, providerKey, { oauthTokens: this.crypto.encryptJson(value) });
  }

  async readCodeVerifier(providerKey: string): Promise<string | undefined> {
    const row = await this.repository.findByProviderKey(this.prisma, providerKey);
    return this.open<string>(row?.oauthCodeVerifier);
  }

  async saveCodeVerifier(providerKey: string, value: string): Promise<void> {
    await this.repository.update(this.prisma, providerKey, { oauthCodeVerifier: this.crypto.encryptJson(value) });
  }

  async clear(providerKey: string, scope: IntegrationCredentialScope): Promise<void> {
    const all = scope === 'all';
    await this.repository.update(this.prisma, providerKey, {
      ...(all || scope === 'client' ? { oauthClientInformation: null } : {}),
      ...(all || scope === 'tokens' ? { oauthTokens: null } : {}),
      ...(all || scope === 'verifier' ? { oauthCodeVerifier: null } : {}),
    });
  }

  /** 마지막 실패 이유를 남기거나(문자열) 지운다(null). 비밀값을 넣지 않는다 */
  async recordError(providerKey: string, error: string | null): Promise<void> {
    await this.repository.update(this.prisma, providerKey, { lastError: error === null ? null : error.slice(0, LAST_ERROR_MAX) });
  }

  private open<T>(payload: string | null | undefined): T | undefined {
    if (!payload) return undefined;
    try {
      return this.crypto.decryptJson<T>(payload);
    } catch (error) {
      if (error instanceof IntegrationDecryptError) {
        throw new AppException('INT-003', '저장된 연결 정보를 풀 수 없어요. INTEGRATION_SECRET_KEY가 바뀌었다면 관리자가 다시 연결해 주세요');
      }
      throw error;
    }
  }
}
