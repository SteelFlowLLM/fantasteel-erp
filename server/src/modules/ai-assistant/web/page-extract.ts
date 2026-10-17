import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { Worker } from 'node:worker_threads';
import { documentShape, domText, htmlToText } from './html-text';
import { tidyText } from './web-text';

/** 모델에 넘기는 페이지 글 길이 (이슈 #367 결정값). 도구 결과 상한(8000자) 안에 안내·감싸기와 함께 들어간다 */
export const PAGE_TEXT_MAX = 6000;

/** Readability가 본문이라고 본 글이 이보다 짧으면 페이지 전체 글로 바꾼다 */
const MIN_ARTICLE_TEXT = 200;
/** 파싱하기 전에 HTML을 이만큼(글자)으로 자른다. 본문 앞 6000자를 찾기에 충분하고, 파싱·Readability 시간을 묶는다 (보안 검토) */
export const EXTRACT_INPUT_MAX = 512 * 1024;
/** Readability가 다루는 요소 수 상한. 넘으면 Readability가 포기하고(예외) 페이지 전체 글로 간다. 2만 겹 div에서 6초·스택 넘침을 막는다 */
export const READABILITY_MAX_ELEMS = 3000;
/** Readability에 넘기는 문서의 가장 깊은 중첩. 보통 페이지는 30~60단 */
export const READABILITY_MAX_DEPTH = 150;
/** 글 뽑기를 맡긴 worker를 기다리는 시간. 넘으면 worker를 끝낸다 */
export const EXTRACT_TIMEOUT_MS = 3000;

export interface ExtractedPage {
  title: string;
  text: string;
}

/** 페이지가 너무 커서·복잡해서 시간 안에 글을 뽑지 못했을 때 */
export class PageTooComplexError extends Error {
  constructor() {
    super('페이지가 너무 복잡해 못 읽었어요');
  }
}

/**
 * 받은 바이트 → 글. 문자 집합은 Content-Type의 charset, 없으면 HTML 앞부분의 <meta charset>, 그래도 없으면 UTF-8.
 * 국내 사이트에 아직 EUC-KR 페이지가 있어 Node의 TextDecoder(전체 ICU)로 푼다.
 */
export function decodeBody(body: Buffer, contentType: string): string {
  const declared = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? sniffMetaCharset(body);
  try {
    return new TextDecoder(declared ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

function sniffMetaCharset(body: Buffer): string | null {
  // 앞 4KB만 본다 (정규식이 긴 입력을 돌지 않게)
  const head = body.subarray(0, 4096).toString('latin1');
  return /<meta[^>]{0,200}charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ?? null;
}

/**
 * 페이지의 제목과 읽을 글. HTML이면 Readability(Firefox 읽기 모드)로 본문만 뽑고, 실패하거나(요소가 너무 많아 포기 포함)
 * 너무 짧으면 메뉴·머리말·꼬리말을 뺀 페이지 전체 글을 쓴다. text/plain은 그대로. 입력은 512K자까지만 본다.
 * 같은 스레드에서 돌므로 서버에서는 extractPageIsolated(worker)로 부른다.
 */
export function extractPage(rawSource: string, contentType: string, url: string): ExtractedPage {
  const source = rawSource.length > EXTRACT_INPUT_MAX ? rawSource.slice(0, EXTRACT_INPUT_MAX) : rawSource;
  if (contentType.startsWith('text/plain')) return { title: fallbackTitle(url), text: tidyText(source) };

  const { document } = parseHTML(source);
  const pageTitle = tidyText(document.title ?? '') || fallbackTitle(url);
  let article: { title?: string | null; content?: string | null } | null = null;
  // 요소가 너무 많거나 너무 깊으면 Readability를 부르지 않는다 (재귀라 깊은 문서에서 몇 초 돌다 스택이 넘친다)
  const shape = documentShape(document, READABILITY_MAX_ELEMS);
  if (shape.elements <= READABILITY_MAX_ELEMS && shape.depth <= READABILITY_MAX_DEPTH) {
    try {
      article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], { charThreshold: MIN_ARTICLE_TEXT, maxElemsToParse: READABILITY_MAX_ELEMS }).parse();
    } catch {
      // 요소가 너무 많음("Aborting parsing document")·스택 넘침 등 → 페이지 전체 글
      article = null;
    }
  }
  let articleText = '';
  try {
    articleText = article?.content ? htmlToText(article.content) : '';
  } catch {
    articleText = '';
  }
  if (articleText.length >= MIN_ARTICLE_TEXT) return { title: tidyText(article?.title ?? '') || pageTitle, text: articleText };

  // Readability가 문서를 고치므로 다시 읽는다. 메뉴·머리말·꼬리말은 돌면서 건너뛴다
  const { document: whole } = parseHTML(source);
  // body가 아니라 문서 전체를 돈다(<html>·<body> 없이 온 조각 페이지도 글을 잃지 않게). <head>는 domText가 건너뛴다
  return { title: pageTitle, text: domText(whole, { skipPageChrome: true }) };
}

/** PDF는 앞 20쪽만 읽는다 (글 뽑기 시간·메모리를 묶는다, 이슈 #384) */
export const PDF_MAX_PAGES = 20;

/**
 * PDF → 제목과 글 (unpdf = pdf.js, 네이티브 모듈 없음). 앞 PDF_MAX_PAGES쪽만, 글은 EXTRACT_INPUT_MAX자까지.
 * 글꼴은 불러오지 않는다(글만 뽑는다). 같은 스레드에서 돌므로 서버에서는 extractPdfIsolated(worker)로 부른다.
 */
export async function extractPdf(data: Uint8Array, url: string): Promise<ExtractedPage> {
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(data, { disableFontFace: true, useSystemFonts: false, stopAtErrors: false });
  try {
    const parts: string[] = [];
    let size = 0;
    for (let n = 1; n <= Math.min(pdf.numPages, PDF_MAX_PAGES) && size < EXTRACT_INPUT_MAX; n += 1) {
      const content = await (await pdf.getPage(n)).getTextContent();
      const text = content.items.map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ''}` : '')).join('');
      parts.push(text);
      size += text.length;
    }
    let title = '';
    try {
      const info = (await pdf.getMetadata()).info as Record<string, unknown> | undefined;
      title = typeof info?.Title === 'string' ? tidyText(info.Title) : '';
    } catch {
      // 메타데이터가 깨진 PDF는 주소로 제목을 정한다
    }
    return { title: title || fallbackTitle(url), text: tidyText(parts.join('\n\n').slice(0, EXTRACT_INPUT_MAX)) };
  } finally {
    await pdf.cleanup();
  }
}

function fallbackTitle(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** 글을 PAGE_TEXT_MAX까지 자르고 잘렸는지 알린다 */
export function limitPageText(text: string, max = PAGE_TEXT_MAX): { text: string; truncated: boolean } {
  return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
}

/**
 * worker 안에서 돌릴 코드. 이 모듈을 불러 extractPage를 부른다.
 * 시험(ts-jest)에서는 이 파일이 .ts라 worker가 tsx로 불러온다. 운영(nest build)은 .js라 그대로 불러온다.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
if (workerData.modulePath.endsWith('.ts')) require('tsx/cjs');
const { extractPage, extractPdf } = require(workerData.modulePath);
parentPort.on('message', async (job) => {
  try {
    const page = job.pdf ? await extractPdf(job.pdf, job.url) : extractPage(job.source, job.contentType, job.url);
    parentPort.postMessage({ type: 'done', page });
  } catch (error) {
    parentPort.postMessage({ type: 'failed', message: String(error && error.message) });
  }
});
parentPort.postMessage({ type: 'ready' });
`;

/** worker를 띄우고 모듈을 불러오는 시간 (글 뽑기 시간과 따로 센다) */
const WORKER_STARTUP_TIMEOUT_MS = 15_000;

type WorkerMessage = { type: 'ready' } | { type: 'done'; page: ExtractedPage } | { type: 'failed'; message: string };

/**
 * 글 뽑기를 worker_threads에서 돌린다. 파싱·Readability는 동기 CPU 작업이라 같은 스레드에서 오래 돌면 서버 전체가 멈춘다.
 * timeoutMs 안에 끝나지 않거나 worker가 죽으면(메모리·스택) worker를 끝내고 PageTooComplexError.
 */
export function extractPageIsolated(source: string, contentType: string, url: string, timeoutMs = EXTRACT_TIMEOUT_MS): Promise<ExtractedPage> {
  return runExtractWorker({ source: source.length > EXTRACT_INPUT_MAX ? source.slice(0, EXTRACT_INPUT_MAX) : source, contentType, url }, timeoutMs);
}

/** PDF 글 뽑기를 worker에서 (HTML과 같은 3초·메모리 한도). 읽지 못하면(깨진 PDF 포함) PageTooComplexError */
export function extractPdfIsolated(body: Buffer, url: string, timeoutMs = EXTRACT_TIMEOUT_MS): Promise<ExtractedPage> {
  return runExtractWorker({ pdf: new Uint8Array(body), url }, timeoutMs);
}

type ExtractJob = { source: string; contentType: string; url: string } | { pdf: Uint8Array; url: string };

function runExtractWorker(job: ExtractJob, timeoutMs: number): Promise<ExtractedPage> {
  return new Promise<ExtractedPage>((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { modulePath: __filename },
      resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
    });
    let settled = false;
    const finish = (outcome: { page: ExtractedPage } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if ('page' in outcome) resolve(outcome.page);
      else reject(outcome.error);
    };
    let timer = setTimeout(() => finish({ error: new PageTooComplexError() }), WORKER_STARTUP_TIMEOUT_MS);
    worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'ready') {
        clearTimeout(timer);
        timer = setTimeout(() => finish({ error: new PageTooComplexError() }), timeoutMs);
        worker.postMessage(job);
      } else if (message.type === 'done') {
        finish({ page: message.page });
      } else {
        finish({ error: new PageTooComplexError() });
      }
    });
    worker.on('error', () => finish({ error: new PageTooComplexError() }));
    worker.on('exit', () => finish({ error: new PageTooComplexError() }));
  });
}
