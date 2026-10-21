// 배포용 Caddyfile(deploy/aws/Caddyfile)의 요청 본문 상한이 서버 코드와 맞는지 (#497): 파일을 올리는 경로가 큰 업로드 목록에 있고, 크기는 서버 상한 이상이다.
// Caddy는 MB를 10^6바이트, MiB를 2^20바이트로 읽는데 서버 상한(MEETING_AUDIO_MAX_BYTES 등)은 2^20 기준이다: MB로 적으면 500MiB 녹음을 Caddy가 먼저 413으로 끊는다.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MEETING_AUDIO_MAX_BYTES, MESSAGE_ATTACHMENT_MAX_BYTES, MESSAGE_ATTACHMENT_MAX_COUNT } from '@fantasteel/shared';

const ROOT = join(__dirname, '..', '..', '..');
const SERVER_SRC = join(ROOT, 'server', 'src');
const MiB = 1024 * 1024;

/** 서버 상한이 기본 JSON 한도(13MiB 안)로 충분한 업로드 경로: 철강맨 부르기 말 조각은 최대 1MiB */
const SMALL_UPLOADS = ['/api/v1/stt/wake-clip'];

const caddyfile = readFileSync(join(ROOT, 'deploy', 'aws', 'Caddyfile'), 'utf8');

/** go-humanize(Caddy)와 같은 뜻으로 크기를 바이트로: MB·KB·GB는 1000 단위, MiB·KiB·GiB는 1024 단위 */
function caddyBytes(text: string): number {
  const match = /^(\d+)(KB|MB|GB|KiB|MiB|GiB)$/.exec(text);
  if (!match) throw new Error(`읽을 수 없는 크기: ${text}`);
  const unit = { KB: 1e3, MB: 1e6, GB: 1e9, KiB: 1024, MiB: MiB, GiB: 1024 * MiB }[match[2] as 'KB'];
  return Number(match[1]) * unit;
}

function caddyMaxSize(blockHead: RegExp): number {
  const match = blockHead.exec(caddyfile);
  if (!match) throw new Error(`Caddyfile에서 ${blockHead} 블록을 찾지 못했어요`);
  return caddyBytes(match[1]);
}

/** `*`는 한 구간(슬래시 사이)에 맞는 와일드카드 (Caddy path 매처의 가운데 와일드카드) */
const globToRegExp = (glob: string) => new RegExp(`^${glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' || entry.name === 'node_modules' ? [] : controllerFiles(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

/** 컨트롤러가 파일을 받는 경로(multer 인터셉터가 붙은 POST·PUT·PATCH). `:id`는 `*`로 바꿔 Caddy 목록과 견준다 */
function uploadRoutes(): string[] {
  const routes: string[] = [];
  for (const file of controllerFiles(SERVER_SRC)) {
    const source = readFileSync(file, 'utf8');
    const prefix = /@Controller\(\s*(?:'([^']*)')?\s*\)/.exec(source)?.[1] ?? '';
    for (const interceptor of source.matchAll(/@UseInterceptors\(\s*(?:File|Files|FileFields|AnyFiles)Interceptor\(/g)) {
      const at = interceptor.index ?? 0;
      // 같은 메서드의 HTTP 데코레이터: 인터셉터 앞쪽에서 가장 가까운 것
      const before = [...source.slice(Math.max(0, at - 600), at).matchAll(/@(?:Post|Put|Patch)\(\s*(?:'([^']*)')?\s*\)/g)].at(-1);
      if (!before) throw new Error(`${relative(ROOT, file)}: 업로드 인터셉터의 HTTP 경로를 찾지 못했어요`);
      const path = ['api/v1', prefix, before[1] ?? ''].filter(Boolean).join('/').replace(/:[A-Za-z]+/g, '*');
      routes.push(`/${path}`);
    }
  }
  return routes;
}

const bigUploads = (/@bigUpload path ([^\n]+)/.exec(caddyfile)?.[1] ?? '').trim().split(/\s+/).filter(Boolean);

describe('deploy/aws/Caddyfile 요청 본문 상한 (#497)', () => {
  it('서버가 파일을 받는 경로를 모두 찾는다 (찾지 못하면 이 시험이 아무것도 보지 못한다)', () => {
    expect(uploadRoutes().sort()).toEqual(['/api/v1/chat-rooms/*/attachments', '/api/v1/meeting-minutes/audio', '/api/v1/stt/transcribe-test', '/api/v1/stt/wake-clip']);
  });

  it('파일을 올리는 경로는 큰 업로드 목록(@bigUpload)에 있거나 작은 업로드로 정해져 있다', () => {
    for (const route of uploadRoutes()) {
      const covered = bigUploads.some((glob) => globToRegExp(glob).test(route.replace('*', 'id'))) || SMALL_UPLOADS.includes(route);
      expect({ route, covered }).toEqual({ route, covered: true });
    }
  });

  it('큰 업로드 목록에는 서버에 없는 낡은 경로가 없다', () => {
    const routes = uploadRoutes().map((route) => route.replace('*', 'id'));
    for (const glob of bigUploads) expect({ glob, exists: routes.some((route) => globToRegExp(glob).test(route)) }).toEqual({ glob, exists: true });
  });

  it('큰 업로드 상한은 서버의 파일 상한(녹음 500MiB·음성 시험 100MiB·첨부 10개)보다 크다', () => {
    const limit = caddyMaxSize(/handle @bigUpload \{\s*request_body \{\s*max_size (\S+)\s*\}/);
    const audioTest = Number(/AUDIO_TEST_MAX_BYTES = (\d+) \* 1024 \* 1024/.exec(readFileSync(join(SERVER_SRC, 'modules', 'stt', 'stt.controller.ts'), 'utf8'))?.[1]) * MiB;
    expect(audioTest).toBeGreaterThan(0);
    // 멀티파트 머리·경계 여유가 1MiB 이상 있어야 서버가 받는 가장 큰 파일이 Caddy를 지난다
    for (const serverLimit of [MEETING_AUDIO_MAX_BYTES, audioTest, MESSAGE_ATTACHMENT_MAX_COUNT * MESSAGE_ATTACHMENT_MAX_BYTES]) expect(limit).toBeGreaterThanOrEqual(serverLimit + MiB);
  });

  it('나머지 API 상한은 서버의 JSON 본문 한도(main.ts) 이상이다', () => {
    const jsonLimit = Number(/useBodyParser\('json',\s*\{\s*limit:\s*'(\d+)mb'/.exec(readFileSync(join(SERVER_SRC, 'main.ts'), 'utf8'))?.[1]) * MiB;
    expect(jsonLimit).toBeGreaterThan(0);
    expect(caddyMaxSize(/handle \{\s*request_body \{\s*max_size (\S+)\s*\}\s*import api_proxy/)).toBeGreaterThanOrEqual(jsonLimit);
  });

  it('max_size는 모두 MiB·KiB·GiB로 적는다 (MB는 10^6바이트라 서버 상한보다 작아진다)', () => {
    const sizes = [...caddyfile.matchAll(/max_size (\S+)/g)].map((match) => match[1]);
    expect(sizes.length).toBeGreaterThanOrEqual(4);
    for (const size of sizes) expect(size).toMatch(/^\d+(KiB|MiB|GiB)$/);
  });
});
