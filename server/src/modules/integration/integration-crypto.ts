import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppException } from '../../common/errors/app.exception';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
/** GCM 권장 nonce 길이 */
const IV_BYTES = 12;
/** 인증 태그 길이. 짧은 태그를 받아 주면 위조가 쉬워지므로 이 길이만 받는다 */
const TAG_BYTES = 16;
/** 저장 형식 버전. 알고리즘·키를 바꿀 때 옛 값과 구분하려고 앞에 둔다 */
const VERSION = 'v1';

/** 키가 다르거나 암호문이 바뀌어 풀 수 없음 */
export class IntegrationDecryptError extends Error {}

/**
 * INTEGRATION_SECRET_KEY 값을 32바이트 키로 읽는다. 64자리 16진수나 base64(32바이트) 둘 다 받는다.
 * 맞지 않으면 null (부르는 쪽이 INT-008로 알린다).
 */
export function parseSecretKey(raw: string | undefined): Buffer | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return decoded.length === KEY_BYTES ? decoded : null;
}

/** `v1:<iv>:<tag>:<암호문>` (각 base64). 같은 글도 매번 다른 iv라 암호문이 달라진다 */
export function encryptSecret(key: Buffer, plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

/** 인증 태그를 확인하므로 암호문이 한 글자라도 바뀌었거나 키가 다르면 IntegrationDecryptError */
export function decryptSecret(key: Buffer, payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new IntegrationDecryptError('암호문 형식이 아니에요');
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new IntegrationDecryptError('암호문 형식이 아니에요');
  const data = parts[3];
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new IntegrationDecryptError('암호문을 풀 수 없어요 (키가 다르거나 값이 바뀌었어요)');
  }
}

/**
 * 외부 연결 비밀값(토큰·OAuth 클라이언트 정보·code verifier)을 DB에 넣기 전에 암호화한다.
 * 키는 부를 때마다 환경변수에서 읽어, 키 없이도 서버는 뜨고 연결 기능만 INT-008로 막힌다.
 */
@Injectable()
export class IntegrationCrypto {
  encrypt(plain: string): string {
    return encryptSecret(this.key(), plain);
  }

  decrypt(payload: string): string {
    return decryptSecret(this.key(), payload);
  }

  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson<T>(payload: string): T {
    return JSON.parse(this.decrypt(payload)) as T;
  }

  private key(): Buffer {
    const key = parseSecretKey(process.env.INTEGRATION_SECRET_KEY);
    if (!key) throw new AppException('INT-008');
    return key;
  }
}
