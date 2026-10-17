import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { Logger } from '@nestjs/common';
import { assertFetchableUrl, BlockedUrlError, DEFAULT_FETCH_POLICY, resolvePublicAddress, type FetchPolicy, type LookupFunction } from '../web/ssrf-guard';
import { BROWSER_LOOKUP } from './browser-dns';

/**
 * 브라우저 전용 프록시 (보안 검토, 이슈 #373). Playwright의 route는 이동(리다이렉트)의 첫 주소만 보여 주므로
 * 302로 사내 주소로 보내면 확인 없이 열린다. 그래서 Chrome의 모든 연결을 이 프록시로 보내고(--proxy-server,
 * 루프백도 프록시로 <-loopback>), 프록시가 주소마다 웹 페이지 읽기와 같은 규칙으로 확인한 뒤 **확인한 IP로** 연결한다.
 * - http: 절대 주소 요청(GET http://host/…)을 받아 전달한다. https: CONNECT host:443을 받아 그대로 잇는다(TLS는 Chrome이 검증)
 * - 127.0.0.1의 임의 포트에만 열고, 띄울 때마다 새로 만든 Basic 인증 값을 아는 연결(우리 Chrome)만 받는다
 * - 막으면 http는 403 글, CONNECT는 403으로 끊는다. 웹소켓 업그레이드는 받지 않는다
 */

const UPSTREAM_TIMEOUT_MS = 15_000;
/** 프록시 쪽에서만 쓰는 헤더(다음 서버로 보내지 않는다) */
const PROXY_HEADERS = ['proxy-authorization', 'proxy-connection', 'proxy-authenticate'];

export interface GuardedProxyOptions {
  policy?: FetchPolicy;
  lookup?: LookupFunction;
  /** 막을 때마다 (주소, 이유). 로그·시험용 */
  onBlocked?: (target: string, reason: string) => void;
}

export class GuardedProxy {
  private readonly logger = new Logger(GuardedProxy.name);
  private readonly policy: FetchPolicy;
  private readonly lookup: LookupFunction;
  readonly username = `fs${randomBytes(6).toString('hex')}`;
  readonly password = randomBytes(18).toString('base64url');
  private readonly expected: Buffer;
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();

  constructor(private readonly options: GuardedProxyOptions = {}) {
    this.policy = options.policy ?? DEFAULT_FETCH_POLICY;
    this.lookup = options.lookup ?? BROWSER_LOOKUP;
    this.expected = Buffer.from(`Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`);
  }

  /** Chrome에 넘길 주소 (http://127.0.0.1:포트) */
  get url(): string {
    const address = this.server?.address() as AddressInfo | null;
    if (!address) throw new Error('프록시가 아직 열리지 않았어요');
    return `http://127.0.0.1:${address.port}`;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => void this.onRequest(req, res));
    server.on('connect', (req: IncomingMessage, socket: Socket, head: Buffer) => void this.onConnect(req, socket, head));
    // 웹소켓 업그레이드는 받지 않는다 (브라우저도 웹소켓을 막는다)
    server.on('upgrade', (_req: IncomingMessage, socket: Socket) => socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'));
    server.on('connection', (socket: Socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    server.on('clientError', (_error, socket: Socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private authorized(req: IncomingMessage): boolean {
    const given = Buffer.from(req.headers['proxy-authorization'] ?? '');
    return given.length === this.expected.length && timingSafeEqual(given, this.expected);
  }

  /** 주소 확인 → 연결할 IP. 막으면 이유 */
  private async check(target: URL): Promise<{ address: string } | { blocked: string }> {
    try {
      assertFetchableUrl(target.href, this.policy);
    } catch (error) {
      if (error instanceof BlockedUrlError) return { blocked: error.message };
      throw error;
    }
    return resolvePublicAddress(target.hostname, this.policy, this.lookup);
  }

  private blocked(target: string, reason: string) {
    this.options.onBlocked?.(target, reason);
    this.logger.debug(`브라우저 요청을 막았어요: ${target} (${reason})`);
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse) {
    if (!this.authorized(req)) {
      res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="fantasteel-browser"', Connection: 'close' }).end();
      return;
    }
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      res.writeHead(400, { Connection: 'close' }).end();
      return;
    }
    const refuse = (reason: string) => {
      this.blocked(target.href, reason);
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' }).end(`막은 주소예요: ${reason}`);
    };
    if (target.protocol !== 'http:') return refuse('http 주소만 프록시로 보내요');
    const checked = await this.check(target).catch(() => ({ blocked: '주소를 확인하지 못했어요' }));
    if ('blocked' in checked) return refuse(checked.blocked);

    const headers = { ...req.headers };
    for (const name of PROXY_HEADERS) delete headers[name];
    const upstream = httpRequest({
      host: checked.address,
      port: Number(target.port || 80),
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers: { ...headers, host: target.host },
      setHost: false,
      agent: false,
      timeout: UPSTREAM_TIMEOUT_MS,
    });
    upstream.on('response', (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
      answer.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('시간 초과')));
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { Connection: 'close' });
      res.end();
    });
    req.pipe(upstream);
  }

  private async onConnect(req: IncomingMessage, socket: Socket, head: Buffer) {
    socket.on('error', () => socket.destroy());
    if (!this.authorized(req)) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="fantasteel-browser"\r\nConnection: close\r\n\r\n');
      return;
    }
    let target: URL;
    try {
      // CONNECT host:port. https 주소로 보고 같은 규칙(포트·막을 호스트·IP)을 쓴다
      target = new URL(`https://${req.url ?? ''}/`);
    } catch {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const refuse = (reason: string) => {
      this.blocked(target.host, reason);
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    };
    const checked = await this.check(target).catch(() => ({ blocked: '주소를 확인하지 못했어요' }));
    if ('blocked' in checked) return refuse(checked.blocked);
    // 포트는 위 확인(80·443)을 지난 값이다
    const upstream = connect({ host: checked.address, port: Number(target.port || 443), timeout: UPSTREAM_TIMEOUT_MS });
    upstream.once('connect', () => {
      upstream.setTimeout(0);
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => {
      if (socket.writable) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    });
    upstream.on('close', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
  }
}
