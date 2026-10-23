// 웹 페이지 읽기의 SSRF 막기·이동·크기 상한 (이슈 #367). 127.0.0.1 시험 서버만 쓴다(바깥 네트워크 없음).
// 시험 서버 자신이 내부 주소라 기본 규칙으로는 막혀야 하고, 읽기 시험은 시험 전용 규칙(127.0.0.1·그 포트만 허용)을 넣는다.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { AssistantWebToolbox, SafeWebPageReader } from './assistant-web-toolbox';
import { tinyPdf } from './fixtures/tiny-pdf';
import { SafePageFetcher, WebFetchError } from './safe-fetch';
import { DEFAULT_FETCH_POLICY, type FetchPolicy, type LookupFunction } from './ssrf-guard';
import { KakaoPlaceClient, WebSearchClient } from './web-search.client';

const ARTICLE = readFileSync(join(__dirname, 'fixtures', 'article.html'), 'utf8');

let server: Server;
let base: string;
let port: string;
/** 요청이 끝까지 읽혔는지(크기 상한에서 끊었는지) 본다 */
let bigBodyFinished = false;
let PDF_BYTES: Buffer = Buffer.alloc(0);
const hits: string[] = [];

function route(req: IncomingMessage, res: ServerResponse) {
  const path = req.url ?? '/';
  hits.push(path);
  const send = (status: number, type: string, body: string | Buffer, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': type, ...headers });
    res.end(body);
  };
  if (path === '/article') return send(200, 'text/html; charset=utf-8', ARTICLE);
  if (path === '/plain') return send(200, 'text/plain; charset=utf-8', '그냥 글이에요');
  if (path === '/gzip') return send(200, 'text/html; charset=utf-8', gzipSync(ARTICLE), { 'content-encoding': 'gzip' });
  if (path === '/pdf') return send(200, 'application/pdf', PDF_BYTES);
  if (path === '/files/doc.pdf') return send(200, 'application/octet-stream', PDF_BYTES);
  if (path === '/big-declared.pdf') return send(200, 'application/pdf', PDF_BYTES, { 'content-length': String(PDF_BYTES.length) });
  if (path === '/files/doc.bin') return send(200, 'application/octet-stream', PDF_BYTES);
  if (path === '/image') return send(200, 'image/png', Buffer.from([0x89, 0x50]));
  if (path === '/missing') return send(404, 'text/html', 'not found');
  if (path === '/redirect-ok') return send(302, 'text/html', '', { location: '/article' });
  if (path === '/redirect-metadata') return send(301, 'text/html', '', { location: 'http://169.254.169.254/latest/meta-data/' });
  if (path === '/redirect-file') return send(302, 'text/html', '', { location: 'file:///etc/passwd' });
  if (path === '/redirect-port') return send(302, 'text/html', '', { location: 'http://example.com:8080/' });
  if (path.startsWith('/loop')) {
    const n = Number(path.slice('/loop'.length) || '0');
    return send(302, 'text/html', '', { location: `/loop${n + 1}` });
  }
  if (path === '/big') {
    res.writeHead(200, { 'content-type': 'text/html' });
    const chunk = Buffer.alloc(64 * 1024, 'a');
    let sent = 0;
    const pump = () => {
      while (sent < 3 * 1024 * 1024) {
        sent += chunk.length;
        if (!res.write(chunk)) return void res.once('drain', pump);
      }
      bigBodyFinished = true;
      res.end();
    };
    res.on('close', () => undefined);
    return pump();
  }
  if (path === '/slow') return; // 응답하지 않는다
  if (path === '/gzip-stall') {
    // 압축 본문 앞부분만 보내고 멈춘다
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' });
    res.write(gzipSync(ARTICLE).subarray(0, 64));
    return;
  }
  return send(404, 'text/plain', '');
}

beforeAll(async () => {
  PDF_BYTES = await tinyPdf(['Steel 1,234']);
  server = createServer(route);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = String((server.address() as AddressInfo).port);
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** 시험 전용 규칙: 127.0.0.1과 시험 서버 포트만 허용 (운영 코드는 환경 변수로 바꿀 수 없다) */
const loopbackPolicy = (): FetchPolicy => ({ isAllowedAddress: (ip) => ip === '127.0.0.1', allowedPorts: [...DEFAULT_FETCH_POLICY.allowedPorts, port] });
const fetchers: SafePageFetcher[] = [];
const fetcher = (options: ConstructorParameters<typeof SafePageFetcher>[0] = {}) => {
  const created = new SafePageFetcher({ policy: loopbackPolicy(), ...options });
  fetchers.push(created);
  return created;
};
afterAll(async () => {
  await Promise.all(fetchers.map((f) => f.close()));
});

const failureOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WebFetchError);
  return (error as Error).message;
};

describe('기본 규칙은 시험 서버(127.0.0.1)도 막는다', () => {
  it('IP를 그대로 적은 주소: 포트를 허용해도 내부 주소라 연결하지 않는다', async () => {
    hits.length = 0;
    const strict = fetcher({ policy: { ...DEFAULT_FETCH_POLICY, allowedPorts: [port] } });
    expect(await failureOf(strict.fetch(`${base}/article`))).toBe('사내망·내부 주소는 읽을 수 없어요');
    expect(hits).toEqual([]);
  });

  it('이름이 내부 주소로 풀리면(DNS 재바인딩 포함) 연결할 때의 lookup에서 막는다', async () => {
    hits.length = 0;
    const toLoopback: LookupFunction = (_hostname, _options, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }]);
    const strict = fetcher({ policy: { ...DEFAULT_FETCH_POLICY, allowedPorts: [port] }, resolve: toLoopback });
    expect(await failureOf(strict.fetch(`http://intranet.example.com:${port}/article`))).toBe('사내망·내부 주소는 읽을 수 없어요');
    expect(hits).toEqual([]);
  });

  it('기본 포트 규칙(80·443)은 다른 포트를 막는다', async () => {
    const strict = fetcher({ policy: DEFAULT_FETCH_POLICY });
    expect(await failureOf(strict.fetch(`${base}/article`))).toBe('80·443 포트의 주소만 읽을 수 있어요');
  });
});

describe('시험 전용 규칙으로 읽기', () => {
  it('HTML을 읽고 최종 주소·형식을 돌려준다. 이름 → 허용 주소는 lookup을 거쳐 연결한다', async () => {
    const page = await fetcher().fetch(`${base}/article`);
    expect(page).toMatchObject({ url: `${base}/article`, contentType: 'text/html; charset=utf-8', truncated: false });
    expect(page.body.toString('utf8')).toContain('3고로');

    const named = fetcher({ resolve: (_h, _o, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }]) });
    expect((await named.fetch(`http://news.example.com:${port}/plain`)).body.toString('utf8')).toBe('그냥 글이에요');
  });

  it('gzip 압축을 풀고, PDF는 통째로 받고(5MB까지), 사진은 읽지 않고, 4xx는 이유를 알린다', async () => {
    expect((await fetcher().fetch(`${base}/gzip`)).body.toString('utf8')).toContain('3고로');
    const pdf = await fetcher().fetch(`${base}/pdf`);
    expect(pdf).toMatchObject({ contentType: 'application/pdf', truncated: false });
    expect(pdf.body.equals(PDF_BYTES)).toBe(true);
    // 형식을 그냥 파일로 알려도 .pdf 주소면 PDF로 본다. .pdf가 아니면 읽지 않는다
    expect((await fetcher().fetch(`${base}/files/doc.pdf`)).contentType).toBe('application/pdf');
    expect(await failureOf(fetcher().fetch(`${base}/files/doc.bin`))).toBe('읽을 수 없는 형식이에요 (application/octet-stream)');
    // 크기 상한: 알린 크기로 먼저 막고, 알리지 않았으면 받는 중에 넘으면 버린다 (잘린 PDF는 읽을 수 없다)
    expect(await failureOf(fetcher({ pdfMaxBytes: 100 }).fetch(`${base}/big-declared.pdf`))).toBe('PDF가 1KB를 넘어 읽지 않았어요');
    expect(await failureOf(fetcher({ pdfMaxBytes: 100 }).fetch(`${base}/pdf`))).toBe('PDF가 1KB를 넘어 읽지 않았어요');
    expect(await failureOf(fetcher().fetch(`${base}/image`))).toBe('읽을 수 없는 형식이에요 (image/png)');
    expect(await failureOf(fetcher().fetch(`${base}/missing`))).toBe('페이지가 404 오류를 돌려줬어요');
  });

  it('이동은 단계마다 주소를 다시 확인한다: 허용 주소는 따라가고, 메타데이터·file·다른 포트로는 가지 않는다', async () => {
    expect((await fetcher().fetch(`${base}/redirect-ok`)).url).toBe(`${base}/article`);
    expect(await failureOf(fetcher().fetch(`${base}/redirect-metadata`))).toBe('사내망·내부 주소는 읽을 수 없어요');
    expect(await failureOf(fetcher().fetch(`${base}/redirect-file`))).toBe('http·https 주소만 읽을 수 있어요');
    expect(await failureOf(fetcher().fetch(`${base}/redirect-port`))).toBe('80·443 포트의 주소만 읽을 수 있어요');
  });

  it('이동은 5번까지', async () => {
    hits.length = 0;
    expect(await failureOf(fetcher().fetch(`${base}/loop0`))).toBe('이동이 5번을 넘어 읽지 않았어요');
    expect(hits).toEqual(['/loop0', '/loop1', '/loop2', '/loop3', '/loop4', '/loop5']);
  });

  it('본문은 상한까지만 읽고 연결을 끊는다 (나머지를 받지 않음)', async () => {
    bigBodyFinished = false;
    const page = await fetcher({ maxBytes: 100_000 }).fetch(`${base}/big`);
    expect(page.body.length).toBe(100_000);
    expect(page.truncated).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bigBodyFinished).toBe(false);
  });

  it('시간 안에 답이 없으면 끊는다', async () => {
    expect(await failureOf(fetcher({ timeoutMs: 200 }).fetch(`${base}/slow`))).toMatch(/초 안에 페이지를 읽지 못했어요/);
  });

  it('압축 본문을 받다가 멈춰도 시간이 지나면 끊는다 (영원히 기다리지 않음)', async () => {
    expect(await failureOf(fetcher({ timeoutMs: 200 }).fetch(`${base}/gzip-stall`))).toMatch(/초 안에 페이지를 읽지 못했어요/);
  });
});

describe('웹 도구 끝에서 끝까지 (가짜 검색 + 실제 읽기)', () => {
  it('검색 결과의 주소를 SSRF를 막는 fetch로 읽어 본문을 감싸 넘긴다', async () => {
    const results = `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(`${base}/redirect-ok`)}">철강신문</a><a class="result__snippet">3고로 개수</a></div>`;
    const search = new WebSearchClient({ fetch: async () => new Response(results, { status: 200, headers: { 'content-type': 'text/html' } }) });
    const toolbox = new AssistantWebToolbox({ search, places: new KakaoPlaceClient(() => null), pages: new SafeWebPageReader(fetcher()) });
    const session = toolbox.session(1);
    await session.run({ id: 'c1', name: 'web_search', arguments: '{"query":"포항 3고로"}' });
    const read = await session.run({ id: 'c2', name: 'read_web_page', arguments: JSON.stringify({ url: `${base}/redirect-ok` }) });
    expect(read.webSources).toEqual([{ title: '포항제철소 3고로 개수 완료 - 철강신문', url: `${base}/article` }]);
    // 최종 주소는 감싼 안에, 밖에는 호스트만
    expect(read.content).toContain(`[웹 페이지] 127.0.0.1\n`);
    expect(read.content).toContain(`<untrusted_web_content source="127.0.0.1">\n주소: ${base}/article\n제목: `);
    expect(read.content).toContain('포항제철소가 3고로 개수 공사를 마치고');
    expect(read.content).not.toContain('should not appear');

    // 같은 시험 서버라도 기본 읽기(운영 규칙)로는 막힌다
    const strict = new AssistantWebToolbox({ search, places: new KakaoPlaceClient(() => null), pages: new SafeWebPageReader(fetcher({ policy: DEFAULT_FETCH_POLICY })) }).session(1);
    await strict.run({ id: 'c1', name: 'web_search', arguments: '{"query":"포항 3고로"}' });
    const blocked = await strict.run({ id: 'c2', name: 'read_web_page', arguments: JSON.stringify({ url: `${base}/redirect-ok` }) });
    expect(JSON.parse(blocked.content).오류).toBe('80·443 포트의 주소만 읽을 수 있어요');
  });
});
