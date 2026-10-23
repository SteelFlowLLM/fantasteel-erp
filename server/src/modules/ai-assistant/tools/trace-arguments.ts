// 도구 호출의 입력을 동작 기록(이슈 #433)에 남길 만큼만 줄인다. 저장한 대화는 오래 남으므로 주소의 쿼리(?token=…)·사람이 볼 수 없는 글을 담지 않는다.
import { isAiAssistantBrowserTool } from '@fantasteel/shared';
import { displayUrl } from '../browser/browser-rules';

/** 브라우저 도구가 남기는 칸: 번호·방향·주소(호스트 + 경로)만. browser_type의 text는 어떤 값이든 남기지 않는다 */
const BROWSER_FIELDS: Record<string, readonly string[]> = {
  browser_open: ['url'],
  browser_click: ['ref'],
  browser_type: ['ref', 'submit'],
  browser_scroll: ['direction'],
  browser_read_file: ['ref', 'url'],
};

/** 허용한 칸만 남긴 브라우저 도구의 입력 JSON. 도구가 브라우저 도구가 아니거나 JSON이 아니면 null */
export function browserTraceArguments(name: string, rawArguments: string): string | null {
  if (!isAiAssistantBrowserTool(name)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments || '{}');
  } catch {
    return '{}';
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return '{}';
  const source = parsed as Record<string, unknown>;
  const kept: Record<string, string | boolean> = {};
  for (const field of BROWSER_FIELDS[name] ?? []) {
    const value = source[field];
    if (field === 'url') {
      const shown = typeof value === 'string' ? displayUrl(value) : '';
      if (shown) kept.url = shown;
    } else if (typeof value === 'boolean') kept[field] = value;
    else if (typeof value === 'string') kept[field] = value.slice(0, 40);
  }
  return JSON.stringify(kept);
}

const LONG_VALUE_MAX = 80;

/**
 * 저장할 입력: 브라우저 도구는 서비스가 이미 줄였고, 나머지(ERP·웹·Notion·Drive)는 80자가 넘는 글 값(본문·긴 검색어)을 앞부분만 남긴다.
 * JSON이 아니면(길어서 잘린 것) 앞 max자만
 */
export function savedTraceArguments(rawArguments: string, max: number): string {
  try {
    const parsed: unknown = JSON.parse(rawArguments);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const reduced = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, typeof value === 'string' && value.length > LONG_VALUE_MAX ? `${value.slice(0, LONG_VALUE_MAX)}…` : value]));
      const text = JSON.stringify(reduced);
      return text.length > max ? `${text.slice(0, max)}…` : text;
    }
  } catch {
    // 잘린 JSON
  }
  return rawArguments.length > max ? `${rawArguments.slice(0, max)}…` : rawArguments;
}
