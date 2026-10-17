// 브라우저 전용 프록시·이름 풀기 (보안 검토, 이슈 #373) 단위 시험. 127.0.0.1 시험 서버만 쓰고 바깥 네트워크·Chrome은 쓰지 않는다.
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net';
import type { Browser } from 'playwright-core';
import type { FetchPolicy, LookupFunction } from '../web/ssrf-guard';
import { decideBrowserRequest, MAX_HOSTS_PER_CONTEXT, type HostDecisionCache } from './browser-guard';
import { resolverLookup } from './browser-dns';
import { BrowserPool, CHROME_ARGS, type ChromeLaunch } from './browser-pool';
import { GuardedProxy } from './browser-proxy';
import { clickBlockReason, normalizeForRules, riskyWordIn } from './browser-rules';

const portOf = (server: Server | TcpServer) => (server.address() as AddressInfo).port;
const listen = <T extends Server | TcpServer>(server: T) => new Promise<T>((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
const close = (server: Server | TcpServer) => new Promise<void>((resolve) => server.close(() => resolve()));

/** 이름 → 주소 (네트워크 없음) */
const table: Record<string, string[]> = { 'ok.test': ['127.0.0.1'], 'blocked.test': ['10.0.0.1'], 'mixed.test': ['127.0.0.1', '10.0.0.2'] };
const lookup: LookupFunction = (hostname, _options, callback) => {
  const addresses = table[hostname];
  if (!addresses) return callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), []);
  callback(null, addresses.map((address) => ({ address, family: 4 })));
};

describe('브라우저 프록시', () => {
  let target: Server;
  let echo: TcpServer;
  let proxy: GuardedProxy;
  const seen: { url: string; headers: IncomingHttpHeaders }[] = [];
  const blocked: string[] = [];

  beforeAll(async () => {
    target = await listen(
      createServer((req, res) => {
        seen.push({ url: req.url ?? '', headers: req.headers });
        res.writeHead(200, { 'content-type': 'text/plain' }).end(`hello ${req.url}`);
      }),
    );
    echo = await listen(createTcpServer((socket: Socket) => socket.pipe(socket)));
    // 시험 규칙: 127.0.0.1과 시험 서버 포트만 공용처럼 본다 (생성자로만 넣는다)
    const policy: FetchPolicy = { isAllowedAddress: (a) => a === '127.0.0.1', allowedPorts: ['', '80', '443', String(portOf(target)), String(portOf(echo))], isDeniedHost: (h) => h === 'erp.example.test' };
    table['erp.example.test'] = ['127.0.0.1'];
    proxy = new GuardedProxy({ policy, lookup, onBlocked: (t) => void blocked.push(t) });
    await proxy.start();
  });
  afterAll(async () => {
    await proxy.stop();
    await close(target);
    await close(echo);
  });

  const auth = () => `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`;
  const proxyPort = () => Number(new URL(proxy.url).port);
  const get = (url: string, authorization: string | null = auth()) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: proxyPort(), method: 'GET', path: url, headers: authorization ? { 'proxy-authorization': authorization, host: new URL(url).host } : { host: new URL(url).host } }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      req.end();
    });
  const tunnel = (authority: string, authorization: string | null = auth()) =>
    new Promise<{ status: number; socket: Socket }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: proxyPort(), method: 'CONNECT', path: authority, headers: authorization ? { 'proxy-authorization': authorization } : {} });
      req.on('connect', (res, socket: Socket) => resolve({ status: res.statusCode ?? 0, socket }));
      req.on('error', reject);
      req.end();
    });

  it('127.0.0.1에만 열고, 인증 값이 없거나 틀리면 407', async () => {
    expect(new URL(proxy.url).hostname).toBe('127.0.0.1');
    expect((await get(`http://ok.test:${portOf(target)}/a`, null)).status).toBe(407);
    expect((await get(`http://ok.test:${portOf(target)}/a`, 'Basic d3Jvbmc6d3Jvbmc=')).status).toBe(407);
    const connect = await tunnel(`ok.test:${portOf(echo)}`, null);
    expect(connect.status).toBe(407);
    connect.socket.destroy();
    expect(seen).toEqual([]);
  });

  it('확인한 주소로 http 요청을 전달하고 Host는 그대로, 프록시 인증 헤더는 넘기지 않는다', async () => {
    const res = await get(`http://ok.test:${portOf(target)}/news?a=1`);
    expect(res).toEqual({ status: 200, body: 'hello /news?a=1' });
    expect(seen.at(-1)?.headers.host).toBe(`ok.test:${portOf(target)}`);
    expect(seen.at(-1)?.headers['proxy-authorization']).toBeUndefined();
  });

  it.each([
    ['내부 주소로 풀리는 이름', () => `http://blocked.test:${portOf(target)}/`],
    ['하나라도 내부 주소로 풀리는 이름', () => `http://mixed.test:${portOf(target)}/`],
    ['허용하지 않은 포트', () => `http://ok.test:1/`],
    ['localhost', () => `http://localhost:${portOf(target)}/`],
    ['IP 그대로의 내부 주소', () => `http://10.0.0.9:${portOf(target)}/`],
    ['막을 호스트', () => `http://erp.example.test:${portOf(target)}/`],
    ['찾지 못한 이름', () => `http://nowhere.test:${portOf(target)}/`],
  ])('%s는 403이고 연결하지 않는다', async (_label, url) => {
    const before = seen.length;
    const res = await get(url());
    expect(res.status).toBe(403);
    expect(res.body).toContain('막은 주소예요');
    expect(seen.length).toBe(before);
  });

  it('CONNECT(https)도 같은 규칙: 확인한 주소로 터널을 잇고, 막을 곳은 403', async () => {
    const ok = await tunnel(`ok.test:${portOf(echo)}`);
    expect(ok.status).toBe(200);
    const reply = await new Promise<string>((resolve) => {
      ok.socket.once('data', (chunk) => resolve(chunk.toString()));
      ok.socket.write('ping');
    });
    expect(reply).toBe('ping');
    ok.socket.destroy();
    for (const authority of [`blocked.test:${portOf(echo)}`, `ok.test:22`, `127.0.0.2:${portOf(echo)}`, `erp.example.test:${portOf(echo)}`]) {
      const res = await tunnel(authority);
      expect(res.status).toBe(403);
      res.socket.destroy();
    }
    expect(blocked).toEqual(expect.arrayContaining([`blocked.test:${portOf(echo)}`]));
  });
});

describe('브라우저 이름 풀기', () => {
  it('A·AAAA를 함께 묻고, 둘 다 없으면 찾지 못함', async () => {
    const resolve = (fn: LookupFunction, host: string) =>
      new Promise<{ error: string | null; addresses: unknown }>((done) => fn(host, { all: true }, (error, addresses) => done({ error: error ? String(error.code) : null, addresses })));
    const lookupFn = resolverLookup({
      resolver: {
        resolve4: async (h) => (h === 'v4.test' ? ['93.184.215.14'] : Promise.reject(new Error('ENODATA'))),
        resolve6: async (h) => (h === 'v4.test' ? ['2606:2800:220:1::1'] : Promise.reject(new Error('ENODATA'))),
      },
    });
    expect(await resolve(lookupFn, 'v4.test')).toEqual({ error: null, addresses: [{ address: '93.184.215.14', family: 4 }, { address: '2606:2800:220:1::1', family: 6 }] });
    expect((await resolve(lookupFn, 'none.test')).error).toBe('ENOTFOUND');
  });

  it('동시에 4개까지만 묻는다', async () => {
    let active = 0;
    let peak = 0;
    const slow = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return ['93.184.215.14'];
    };
    const lookupFn = resolverLookup({ resolver: { resolve4: slow, resolve6: async () => [] } });
    await Promise.all(Array.from({ length: 12 }, (_, i) => new Promise((done) => lookupFn(`h${i}.test`, { all: true }, done))));
    expect(peak).toBeLessThanOrEqual(4);
  });

  it(`한 컨텍스트에서 서로 다른 호스트는 ${MAX_HOSTS_PER_CONTEXT}개까지`, async () => {
    const cache: HostDecisionCache = new Map();
    const any: LookupFunction = (_h, _o, callback) => callback(null, [{ address: '93.184.215.14', family: 4 }]);
    for (let i = 0; i < MAX_HOSTS_PER_CONTEXT; i += 1) expect(await decideBrowserRequest({ url: `https://h${i}.example.com/`, method: 'GET', isNavigation: false }, { resolve: any, cache })).toEqual({ allow: true });
    expect(await decideBrowserRequest({ url: 'https://one-more.example.com/', method: 'GET', isNavigation: false }, { resolve: any, cache })).toMatchObject({ allow: false, reason: expect.stringContaining('100개') });
    expect(await decideBrowserRequest({ url: 'https://h3.example.com/x', method: 'GET', isNavigation: false }, { resolve: any, cache })).toEqual({ allow: true });
  });
});

describe('Chrome 띄우기 설정', () => {
  const chrome = (p: string) => p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const fakeBrowser = { on: () => undefined, close: async () => undefined } as unknown as Browser;

  it('프록시(127.0.0.1·띄울 때마다 새 인증 값)와 샌드박스(기본 켬)를 넘기고, 닫으면 프록시도 닫는다', async () => {
    const launches: ChromeLaunch[] = [];
    const pool = new BrowserPool({ env: { AI_BROWSER_ENABLED: 'true' }, platform: 'darwin', exists: chrome, launch: async (options) => (launches.push(options), fakeBrowser) });
    const context = await pool.openContext(async () => ({ on: () => undefined, close: async () => undefined }) as never);
    expect(launches).toHaveLength(1);
    const [launch] = launches;
    expect(launch.sandbox).toBe(true);
    expect(launch.executablePath).toBeNull();
    expect(launch.proxy.server).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(launch.proxy.username).toMatch(/^fs[0-9a-f]{12}$/);
    expect(launch.proxy.password.length).toBeGreaterThanOrEqual(20);
    // 프록시가 떠 있고 인증 없는 요청은 거절한다
    const status = await new Promise<number>((resolve) => request({ host: '127.0.0.1', port: Number(new URL(launch.proxy.server).port), path: 'http://ok.test/' }, (res) => resolve(res.statusCode ?? 0)).end());
    expect(status).toBe(407);
    await pool.release(context as never);
    await pool.shutdown();
    await expect(new Promise((resolve, reject) => request({ host: '127.0.0.1', port: Number(new URL(launch.proxy.server).port), path: '/' }, resolve).on('error', reject).end())).rejects.toThrow();
    expect(CHROME_ARGS).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  });

  it('BROWSER_NO_SANDBOX=true일 때만 샌드박스를 끈다', async () => {
    const launches: ChromeLaunch[] = [];
    const pool = new BrowserPool({ env: { AI_BROWSER_ENABLED: 'true', BROWSER_NO_SANDBOX: 'true' }, platform: 'darwin', exists: chrome, launch: async (options) => (launches.push(options), fakeBrowser) });
    await pool.openContext(async () => ({ on: () => undefined, close: async () => undefined }) as never);
    expect(launches[0].sandbox).toBe(false);
    await pool.shutdown();
  });
});

describe('낱말 검사 전 글 다듬기', () => {
  it.each(['로​그인', '로⁣그인', 'ｌｏｇｉｎ', 'Ｓｉｇｎ Ｉｎ', '결­제', '탈ㅤ퇴'])('"%s"도 막는다', (name) => {
    expect(riskyWordIn(name)).not.toBeNull();
  });

  it.each(['장바구니 담기', '예약하기', '신청', '회원 탈퇴', '구독 해지', 'Register', 'Add to cart', 'add-to-cart'])('새로 막는 낱말 "%s"', (name) => {
    expect(clickBlockReason({ tag: 'button', role: 'button', name, text: name, value: '', filled: false, type: '', href: null, autocomplete: '', hints: '', inForm: false, formMethod: null, isSubmitter: false, submitterMethod: null, download: false, editable: false, disabled: false, checked: null })).not.toBeNull();
  });

  it('NFKC로 바꾸고 보이지 않는 글자를 지운다', () => {
    expect(normalizeForRules('ｃｃ－ｎｕｍｂｅｒ‍')).toBe('cc-number');
  });
});
