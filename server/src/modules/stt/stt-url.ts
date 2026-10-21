import { registerDecorator, type ValidationOptions } from 'class-validator';

/** 클라우드 메타데이터 서버 이름. 주소(169.254.169.254)와 같은 이유로 막는다 */
const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata', 'instance-data']);

/**
 * 음성 서버 주소로 받지 않는 곳: 링크 로컬(169.254.0.0/16, IPv6 fe80::/10)과 클라우드 메타데이터 이름.
 * 사설망·Tailscale·localhost는 관리자가 직접 넣는 서버 설정이라 허용하지만, 메타데이터 서버는 ERP 서버의 자격 증명을 내주는 곳이라 막는다.
 * WHATWG URL이 10진수·16진수 IP(2852039166)와 IPv6 매핑(::ffff:169.254.169.254)을 정규화하므로 정규화된 hostname으로 본다.
 */
export function isBlockedSttHost(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (METADATA_HOSTS.has(host.replace(/\.$/, ''))) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  return mapped !== null && parseInt(mapped[1], 16) === 0xa9fe;
}

/** 오류 문구에 주소를 보일 때 주소 안의 아이디·비밀번호를 뺀다 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) return url;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return url.replace(/\/\/[^/@]*@/, '//');
  }
}

/** 주소 출처(프로토콜+호스트+포트)가 같은가. 저장된 API 키는 같은 출처로만 보낸다 */
export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export function IsAllowedSttHost(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isAllowedSttHost',
      target: target.constructor,
      propertyName,
      options: { message: '링크 로컬(169.254.x.x)·클라우드 메타데이터 주소는 음성 서버로 쓸 수 없어요', ...options },
      validator: { validate: (value: unknown) => typeof value !== 'string' || !isBlockedSttHost(value) },
    });
}
