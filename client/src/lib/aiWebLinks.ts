// 철강맨AI 웹 검색 (이슈 #367)의 링크 도우미. 웹에서 온 글(출처 제목·모델이 쓴 답)은 믿을 수 없어서
// 글로만 보이게 하고, 눌러 열리는 링크는 서버가 이번 질문의 웹 도구 결과로 알려 준 주소(reply.webSources)만 만든다.
import type { AiWebSource } from '@fantasteel/shared';

/** 이보다 긴 주소는 링크로 만들지 않는다 (글로만 보인다) */
export const MAX_WEB_URL_LENGTH = 2048;
/** 링크 글자(대괄호 안)로 보는 최대 길이. 이보다 길면 링크가 아니라 글이다 */
const MAX_LINK_TEXT_LENGTH = 300;
/** 이보다 긴 답은 앞부분만 링크로 풀고 나머지는 글로 둔다 (잘못 짜인 긴 글에서 느려지지 않게) */
const MAX_TOKENIZED_LENGTH = 20_000;
const MAX_SOURCE_TITLE_LENGTH = 120;

/**
 * 눌러 열어도 되는 주소를 비교용 모양으로 바꾼다. http·https만(대소문자 무시)이고, 아이디·비밀번호가 든 주소,
 * `//host` 같은 상대 주소, 스킴 없는 `www.…`는 null. 소문자 스킴·호스트, 조각(#…)과 끝 슬래시를 뺀다
 */
export function normalizeWebUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > MAX_WEB_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || !url.host) return null;
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  return `${url.protocol}//${url.host}${path}${url.search}`;
}

/** 링크의 href로 쓸 안전한 주소 (http·https만). 아니면 null */
export function safeWebHref(raw: string): string | null {
  return normalizeWebUrl(raw) === null ? null : new URL(raw.trim()).href;
}

/** 주소의 호스트 (www. 는 뺀다). 못 읽으면 null */
export function webHostOf(raw: string): string | null {
  if (normalizeWebUrl(raw) === null) return null;
  return new URL(raw.trim()).hostname.replace(/^www\./, '');
}

/** 출처 제목을 화면에 보일 글로: 제어 문자·글자 방향을 바꾸는 문자를 빼고 공백을 줄이고 길이를 자른다. 비면 호스트 */
export function webSourceTitle(title: string, url: string): string {
  const cleaned = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return webHostOf(url) ?? '제목 없음';
  return cleaned.length > MAX_SOURCE_TITLE_LENGTH ? `${cleaned.slice(0, MAX_SOURCE_TITLE_LENGTH)}…` : cleaned;
}

/** 출처 목록에서 링크로 열 수 있는 것만 (http·https), 같은 주소는 하나 */
export function openableWebSources(sources: readonly AiWebSource[] | undefined): { title: string; href: string; host: string }[] {
  const seen = new Set<string>();
  const result: { title: string; href: string; host: string }[] = [];
  for (const source of sources ?? []) {
    const key = normalizeWebUrl(source.url);
    const href = safeWebHref(source.url);
    if (key === null || href === null || seen.has(key)) continue;
    seen.add(key);
    result.push({ title: webSourceTitle(source.title, source.url), href, host: webHostOf(source.url) ?? '' });
  }
  return result;
}

export type AnswerToken = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

interface Parsed {
  /** 대괄호 안의 글 */
  label: string;
  /** 소괄호 안의 주소 (제목은 뺀 것) */
  target: string;
  /** 파싱이 끝난 다음 위치 */
  end: number;
}

/** `[글](주소 "제목")` 한 개를 text[start]('[')부터 읽는다. 대괄호는 겹쳐도 짝을 센다. 모양이 아니면 null */
function parseMarkdownLink(text: string, start: number): Parsed | null {
  let depth = 0;
  let close = -1;
  const labelLimit = Math.min(text.length, start + MAX_LINK_TEXT_LENGTH + 2);
  for (let i = start; i < labelLimit; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      i += 1;
    } else if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0 || text[close + 1] !== '(') return null;

  const targetStart = close + 2;
  const targetLimit = Math.min(text.length, targetStart + MAX_WEB_URL_LENGTH + 2);
  let parens = 1;
  let end = -1;
  for (let i = targetStart; i < targetLimit; i += 1) {
    const ch = text[i];
    if (ch === '(') parens += 1;
    else if (ch === ')') {
      parens -= 1;
      if (parens === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;

  const inside = text.slice(targetStart, end).trim();
  // 주소 뒤에 선택으로 "제목"이 올 수 있다. 그 밖의 공백이 든 모양은 링크가 아니다
  const titled = /^(\S+)(?:\s+(?:"[^"]*"|'[^']*'))?$/.exec(inside);
  if (!titled) return null;
  const target = titled[1].replace(/^<(.*)>$/, '$1');
  return { label: text.slice(start + 1, close), target, end: end + 1 };
}

const URL_CHAR = /[\x21-\x7e]/;
const URL_STOP = new Set(['<', '>', '"', "'", '`', '\\', '[', ']', '{', '}', '|', '^']);
const TRAILING_PUNCT = new Set(['.', ',', ';', ':', '!', '?', ')', '*', '_', '~']);

/** text[start]부터 `http(s)://…` 맨 주소를 읽는다. 끝의 문장부호는 뺀다. 아니면 null */
function parseBareUrl(text: string, start: number): string | null {
  const head = text.slice(start, start + 8).toLowerCase();
  if (!head.startsWith('http://') && !head.startsWith('https://')) return null;
  let end = start;
  while (end < text.length && end - start <= MAX_WEB_URL_LENGTH + 1 && URL_CHAR.test(text[end]) && !URL_STOP.has(text[end])) end += 1;
  while (end > start && TRAILING_PUNCT.has(text[end - 1])) {
    // 주소 안의 짝 맞는 괄호는 남긴다: …/wiki/A_(b)
    if (text[end - 1] === ')') {
      const body = text.slice(start, end);
      if (body.split('(').length >= body.split(')').length) break;
    }
    end -= 1;
  }
  return end - start > 8 ? text.slice(start, end) : null;
}

/** 이미지 `![alt](주소)`는 그리지 않고 alt 글만 남긴다 */
function plainLabel(label: string): string {
  return label.replace(/!\[([^\]]*)\]\([^)\s]*\)/g, '$1');
}

/**
 * 최종 답을 글과 링크 조각으로 나눈다. 링크는 주소가 allowed(이번 질문의 웹 출처)에 있을 때만 만들고,
 * 나머지 주소·`javascript:` 같은 스킴·`//host`·`www.…`·HTML은 모두 글이다. 이미지는 alt 글만 보인다.
 * 글은 React가 글로 그리므로 HTML로 해석되지 않는다
 */
export function tokenizeAnswerLinks(answer: string, allowed: readonly AiWebSource[] | undefined): AnswerToken[] {
  const allowedKeys = new Set<string>();
  for (const source of allowed ?? []) {
    const key = normalizeWebUrl(source.url);
    if (key) allowedKeys.add(key);
  }

  const tokens: AnswerToken[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) tokens.push({ kind: 'text', text: buffer });
    buffer = '';
  };
  const linkFor = (target: string): string | null => {
    const key = normalizeWebUrl(target);
    return key !== null && allowedKeys.has(key) ? safeWebHref(target) : null;
  };

  const limit = Math.min(answer.length, MAX_TOKENIZED_LENGTH);
  let i = 0;
  while (i < limit) {
    const ch = answer[i];
    const isImage = ch === '!' && answer[i + 1] === '[';
    if (ch === '[' || isImage) {
      const parsed = parseMarkdownLink(answer, isImage ? i + 1 : i);
      if (parsed) {
        if (isImage) {
          buffer += plainLabel(parsed.label);
        } else {
          const href = linkFor(parsed.target);
          const label = plainLabel(parsed.label).trim();
          if (href && label) {
            flush();
            tokens.push({ kind: 'link', text: label, href });
          } else {
            // 허용하지 않은 주소는 어디로 가는지 보이게 원문 그대로 둔다
            buffer += answer.slice(i, parsed.end);
          }
        }
        i = parsed.end;
        continue;
      }
    } else if (ch === 'h' || ch === 'H') {
      const url = parseBareUrl(answer, i);
      if (url) {
        const href = linkFor(url);
        if (href) {
          flush();
          tokens.push({ kind: 'link', text: url, href });
        } else {
          buffer += url;
        }
        i += url.length;
        continue;
      }
    }
    buffer += ch;
    i += 1;
  }
  buffer += answer.slice(limit);
  flush();
  return tokens;
}
