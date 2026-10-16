// 외부 연결 비밀값 암호화(AES-256-GCM): 왕복, 위변조 감지, 다른 키, 키 형식 읽기를 확인한다.
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, IntegrationCrypto, IntegrationDecryptError, parseSecretKey } from './integration-crypto';

const key = randomBytes(32);

describe('encryptSecret · decryptSecret', () => {
  it('암호화한 글을 그대로 되돌린다 (한글·JSON 포함)', () => {
    const plain = JSON.stringify({ access_token: 'tok-한글', refresh_token: 'r'.repeat(500) });
    const payload = encryptSecret(key, plain);
    expect(payload.startsWith('v1:')).toBe(true);
    expect(payload).not.toContain('tok-');
    expect(decryptSecret(key, payload)).toBe(plain);
  });

  it('같은 글도 매번 다른 암호문이 된다', () => {
    expect(encryptSecret(key, 'same')).not.toBe(encryptSecret(key, 'same'));
  });

  it('암호문이 한 글자라도 바뀌면 풀지 않는다', () => {
    const [version, iv, tag, data] = encryptSecret(key, 'secret-value').split(':');
    const bytes = Buffer.from(data, 'base64');
    bytes[0] ^= 0x01;
    expect(() => decryptSecret(key, [version, iv, tag, bytes.toString('base64')].join(':'))).toThrow(IntegrationDecryptError);
    const badTag = Buffer.from(tag, 'base64');
    badTag[0] ^= 0x01;
    expect(() => decryptSecret(key, [version, iv, badTag.toString('base64'), data].join(':'))).toThrow(IntegrationDecryptError);
  });

  it('다른 키로는 풀지 않는다', () => {
    const payload = encryptSecret(key, 'secret-value');
    expect(() => decryptSecret(randomBytes(32), payload)).toThrow(IntegrationDecryptError);
  });

  it('형식이 아닌 값은 풀지 않는다', () => {
    expect(() => decryptSecret(key, 'plain-text')).toThrow(IntegrationDecryptError);
    expect(() => decryptSecret(key, 'v2:a:b:c')).toThrow(IntegrationDecryptError);
  });
});

describe('parseSecretKey', () => {
  it('64자리 16진수와 base64(32바이트)를 읽는다', () => {
    expect(parseSecretKey(key.toString('hex'))?.equals(key)).toBe(true);
    expect(parseSecretKey(key.toString('base64'))?.equals(key)).toBe(true);
    expect(parseSecretKey(` ${key.toString('base64url')} `)?.equals(key)).toBe(true);
  });

  it('없거나 길이가 맞지 않으면 null', () => {
    expect(parseSecretKey(undefined)).toBeNull();
    expect(parseSecretKey('')).toBeNull();
    expect(parseSecretKey(randomBytes(16).toString('base64'))).toBeNull();
    expect(parseSecretKey('not a key!')).toBeNull();
  });
});

describe('IntegrationCrypto', () => {
  const saved = process.env.INTEGRATION_SECRET_KEY;
  afterEach(() => {
    process.env.INTEGRATION_SECRET_KEY = saved;
  });

  it('환경변수 키로 JSON을 암호화하고 되돌린다', () => {
    process.env.INTEGRATION_SECRET_KEY = key.toString('base64');
    const crypto = new IntegrationCrypto();
    expect(crypto.decryptJson(crypto.encryptJson({ a: 1 }))).toEqual({ a: 1 });
  });

  it('키가 없으면 INT-008', () => {
    delete process.env.INTEGRATION_SECRET_KEY;
    expect(() => new IntegrationCrypto().encrypt('x')).toThrow(expect.objectContaining({ code: 'INT-008' }));
  });
});
