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
 * DNS 이름이 가리키는 주소(169.254.169.254.nip.io 같은 것)는 여기서 알 수 없다: 이름은 연결할 때 푼 주소를 guarded-agent.ts가 isCloudMetadataAddress로 다시 본다.
 */
export function isBlockedServerHost(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (METADATA_HOSTS.has(host.replace(/\.$/, ''))) return true;
  return isBlockedServerAddress(host);
}

/**
 * 주소로 적은 글(IP 글자)이 막을 주소인지: 클라우드 메타데이터 + IPv6 링크 로컬(fe80::/10). isBlockedServerHost가 글로 적은 주소를 볼 때 쓴다.
 * 이름이나 IP가 아닌 글은 막지 않는다
 */
export function isBlockedServerAddress(address: string): boolean {
  return isBlockedAddressText(address, true);
}

/**
 * DNS가 이름을 푼 주소가 클라우드 메타데이터 주소인지 (IPv4 169.254.0.0/16, fd00:ec2::254, 100.100.100.200, 이들을 담은 IPv4-mapped·NAT64).
 * 연결할 때 이름이 풀린 주소를 보는 데 쓴다(common/net/guarded-agent.ts): 169.254.169.254.nip.io 같은 이름이 메타데이터 주소로 풀리는 것을 막는다.
 * IPv6 링크 로컬(fe80::/10)은 막지 않는다: LAN의 `*.local`(mDNS) 이름은 192.168.x.x와 함께 fe80::…을 돌려주는 것이 보통이고 메타데이터 서버가 아니다.
 * 글로 적은 [fe80::1] 주소를 저장 때 막는 것(isBlockedServerAddress)과 다르다
 */
export function isCloudMetadataAddress(address: string): boolean {
  return isBlockedAddressText(address, false);
}

function isBlockedAddressText(address: string, includeLinkLocalV6: boolean): boolean {
  // fe80::1%eth0 같은 영역 표시는 떼고 본다 (fe80::/10은 영역이 붙어도 링크 로컬이다)
  const bare = address.replace(/^\[|\]$/g, '').split('%')[0];
  return ipaddr.isValid(bare) && isBlockedIp(ipaddr.parse(bare), includeLinkLocalV6);
}

function isBlockedIp(address: ipaddr.IPv4 | ipaddr.IPv6, includeLinkLocalV6: boolean): boolean {
  if (address.kind() === 'ipv4') return address.range() === 'linkLocal' || METADATA_ADDRESSES.has(address.toNormalizedString());
  const v6 = address as ipaddr.IPv6;
  if ((includeLinkLocalV6 && v6.range() === 'linkLocal') || METADATA_ADDRESSES.has(v6.toNormalizedString())) return true;
  const embedded = embeddedIpv4(v6);
  return embedded !== null && isBlockedIp(embedded, includeLinkLocalV6);
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
