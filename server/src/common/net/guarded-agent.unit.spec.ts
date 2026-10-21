// LLM·음성 서버 연결용 Agent (#497): 이름이 클라우드 메타데이터 주소로 풀리면 연결하지 않고, localhost·사설망·Tailscale로 풀리는 이름은 연결한다.
// 이름 풀기는 가짜 resolver로 정하고, 연결은 127.0.0.1 시험 서버로만 한다 (메타데이터 주소로 실제 연결하지 않는다).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetch as undiciFetch } from 'undici';
import type { LookupFunction } from '../../modules/ai-assistant/web/ssrf-guard';
import { createMetadataGuardedAgent, isBlockedLookupError } from './guarded-agent';

let server: Server;
let port: number;
let hits = 0;

beforeAll(async () => {
  server = createServer((_req, res) => {
    hits += 1;
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  hits = 0;
});

/** 이름 → 주소 목록을 정해 둔 resolver (net의 lookup처럼 all: true로 불린다) */
const resolverOf =
  (table: Record<string, string[]>): LookupFunction =>
  (hostname, _options, callback) => {
    const addresses = table[hostname];
    if (!addresses) return callback(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }), []);
    callback(
      null,
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    );
  };

const resolve = resolverOf({
  'meta.test': ['169.254.169.254'],
  'mapped.test': ['::ffff:a9fe:a9fe'],
  'aws-v6.test': ['fd00:ec2::254'],
  'linklocal.test': ['fe80::1'],
  'mixed.test': ['127.0.0.1', '169.254.169.254'],
  'local.test': ['127.0.0.1'],
});

async function get(name: string, table: LookupFunction = resolve): Promise<{ text: string } | { error: unknown }> {
  const agent = createMetadataGuardedAgent({}, table);
  try {
    const res = await undiciFetch(`http://${name}:${port}/`, { dispatcher: agent });
    return { text: await res.text() };
  } catch (error) {
    return { error };
  } finally {
    await agent.close();
  }
}

describe('createMetadataGuardedAgent', () => {
  it.each(['meta.test', 'mapped.test', 'aws-v6.test', 'linklocal.test', 'mixed.test'])('이름 %s 이 메타데이터 주소로 풀리면 연결하지 않는다', async (name) => {
    const result = await get(name);
    expect('error' in result && isBlockedLookupError(result.error)).toBe(true);
    // 시험 서버에는 요청이 가지 않았다
    expect(hits).toBe(0);
  });

  it('localhost·사설망·Tailscale 같은 주소로 풀리는 이름은 연결한다', async () => {
    expect(await get('local.test')).toEqual({ text: 'ok' });
    expect(hits).toBe(1);
  });

  it('이름을 찾지 못한 오류는 막힘이 아니다', async () => {
    const result = await get('nowhere.test');
    expect('error' in result && isBlockedLookupError(result.error)).toBe(false);
  });
});

describe('isBlockedLookupError', () => {
  it('cause·errors로 여러 겹 싸여 와도 막힘을 찾고, 다른 오류는 아니다', () => {
    const blocked = Object.assign(new Error('내부 주소'), { code: 'EBLOCKED' });
    expect(isBlockedLookupError(Object.assign(new TypeError('fetch failed'), { cause: blocked }))).toBe(true);
    expect(isBlockedLookupError(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new AggregateError([new Error('x'), blocked]), {}) }))).toBe(true);
    expect(isBlockedLookupError(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) }))).toBe(false);
    expect(isBlockedLookupError(new TypeError('fetch failed'))).toBe(false);
    expect(isBlockedLookupError('글')).toBe(false);
    expect(isBlockedLookupError(undefined)).toBe(false);
  });
});
