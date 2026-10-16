import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { htmlToText, tidyText } from './web-text';

/** 모델에 넘기는 페이지 글 길이 (이슈 #367 결정값). 도구 결과 상한(8000자) 안에 안내·감싸기와 함께 들어간다 */
export const PAGE_TEXT_MAX = 6000;

/** Readability가 본문이라고 본 글이 이보다 짧으면 페이지 전체 글로 바꾼다 */
const MIN_ARTICLE_TEXT = 200;

export interface ExtractedPage {
  title: string;
  text: string;
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
  const head = body.subarray(0, 4096).toString('latin1');
  return /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ?? null;
}

/**
 * 페이지의 제목과 읽을 글. HTML이면 Readability(Firefox 읽기 모드)로 본문만 뽑고, 실패하거나 너무 짧으면
 * 메뉴·머리말·꼬리말을 뺀 페이지 전체 글을 쓴다. text/plain은 그대로.
 */
export function extractPage(source: string, contentType: string, url: string): ExtractedPage {
  if (contentType.startsWith('text/plain')) return { title: fallbackTitle(url), text: tidyText(source) };

  const { document } = parseHTML(source);
  const pageTitle = tidyText(document.title ?? '') || fallbackTitle(url);
  let article: { title?: string | null; content?: string | null } | null = null;
  try {
    article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], { charThreshold: MIN_ARTICLE_TEXT }).parse();
  } catch {
    article = null;
  }
  const articleText = article?.content ? htmlToText(article.content) : '';
  if (articleText.length >= MIN_ARTICLE_TEXT) return { title: tidyText(article?.title ?? '') || pageTitle, text: articleText };

  // Readability가 문서를 고치므로 다시 읽는다
  const { document: whole } = parseHTML(source);
  for (const node of whole.querySelectorAll('script,style,noscript,template,svg,nav,header,footer,aside,form,iframe')) node.remove();
  const bodyHtml = whole.body?.innerHTML ?? source;
  return { title: pageTitle, text: htmlToText(bodyHtml) };
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
