import { registerDecorator, type ValidationOptions } from 'class-validator';
import ipaddr from 'ipaddr.js';

/** 클라우드 메타데이터 서버 이름. 주소(169.254.169.254)와 같은 이유로 막는다 */
const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.goog', 'metadata', 'instance-data', 'instance-data.ec2.internal']);

/**
 * 링크 로컬(169.254.0.0/16·fe80::/10) 밖에 있는 메타데이터 주소: AWS의 IPv6 주소와 Alibaba Cloud(Tailscale이 쓰는 100.64.0.0/10 안이라 이 주소만 막는다).
 * 이 서버가 AWS에 있어 fd00:ec2::254를 막지 않으면 IPv6로 인스턴스 자격 증명에 닿는다
 */
const METADATA_ADDRESSES = new Set(['fd00:ec2::254', '100.100.100.200'].map((address) => ipaddr.parse(address).toNormalizedString()));
const IPV4_COMPATIBLE = ipaddr.parseCIDR('::/96') as [ipaddr.IPv6, number];

/**
 * LLM·음성 서버 주소로 받지 않는 곳: 링크 로컬(IPv4 169.254.0.0/16, IPv6 fe80::/10)과 클라우드 메타데이터 이름·주소.
 * 사설망·Tailscale·localhost는 관리자가 직접 넣는 로컬 LLM·음성 서버라 허용하지만, 메타데이터 서버는 ERP 서버의 자격 증명을 내주는 곳이라 막는다.
 * WHATWG URL이 10진수·16진수·8진수 IP(2852039166)와 IPv6 표기(대문자·0 생략)를 정규화하므로 정규화된 hostname으로 보고,
 * IPv4가 IPv6 안에 담긴 주소(::ffff:169.254.169.254, NAT64 64:ff9b::…)는 IPv4로 풀어서 다시 본다.
 * DNS 이름이 가리키는 주소(169.254.169.254.nip.io 같은 것)는 여기서 풀지 않는다: 이름은 이 검사로 알 수 없다.
 */
export function isBlockedServerHost(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (METADATA_HOSTS.has(host.replace(/\.$/, ''))) return true;
  if (!ipaddr.isValid(host)) return false;
  return isBlockedAddress(ipaddr.parse(host));
}

function isBlockedAddress(address: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  if (address.kind() === 'ipv4') return address.range() === 'linkLocal' || METADATA_ADDRESSES.has(address.toNormalizedString());
  const v6 = address as ipaddr.IPv6;
  if (v6.range() === 'linkLocal' || METADATA_ADDRESSES.has(v6.toNormalizedString())) return true;
  const embedded = embeddedIpv4(v6);
  return embedded !== null && isBlockedAddress(embedded);
}

/** IPv6 주소 끝 32비트에 IPv4가 담긴 형태: IPv4-mapped(::ffff:a.b.c.d)·NAT64(64:ff9b::/96)·옛 IPv4-compatible(::a.b.c.d). 아니면 null */
function embeddedIpv4(v6: ipaddr.IPv6): ipaddr.IPv4 | null {
  if (v6.isIPv4MappedAddress()) return v6.toIPv4Address();
  if (v6.range() !== 'rfc6052' && !v6.match(IPV4_COMPATIBLE)) return null;
  const [high, low] = v6.parts.slice(6);
  return new ipaddr.IPv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
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

/** 서버 주소 칸에 isBlockedServerHost를 건다. label은 오류 문구에 들어갈 서버 이름(예: 음성 서버, AI 서버) */
export function IsAllowedServerHost(label: string, options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isAllowedServerHost',
      target: target.constructor,
      propertyName,
      options: { message: `링크 로컬(169.254.x.x)·클라우드 메타데이터 주소는 ${label}로 쓸 수 없어요`, ...options },
      validator: { validate: (value: unknown) => typeof value !== 'string' || !isBlockedServerHost(value) },
    });
}
