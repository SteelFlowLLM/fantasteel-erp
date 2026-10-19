// 철강맨AI Notion (이슈 #398, 문서에 없는 기능)의 화면 도우미: 켜기 설정 저장, 못 켤 때 이유, 도구 줄 요약.
// 켜기는 사원별이 아니라 이 브라우저에 저장한다 (계정에 저장할 컬럼이 ERD에 없다).
import type { AiNotionCapabilities, AiWebSource } from '@fantasteel/shared';

export const AI_NOTION_KEY = 'fantasteel.ai-notion';

/** 켜기 단추 설명 */
export const AI_NOTION_TITLE = '켜면 철강맨AI가 회사 Notion(ERP 상위 페이지 아래)을 찾아 읽어요. 쓰기는 실행 카드로만 하고, [실행]을 눌러야 반영돼요.';
export const AI_NOTION_OFF_REASON = 'Notion을 쓸 수 없어요';
export const AI_NOTION_UNAVAILABLE_HINT = 'AI 연결을 확인하지 못해 지금은 켤 수 없어요';

/** 저장된 글에서 켜기 설정을 읽는다. 깨졌거나 없으면 꺼짐 */
export function parseAiNotionPreference(raw: string | null): boolean {
  return raw === 'true';
}

export function readAiNotionPreference(): boolean {
  try {
    return parseAiNotionPreference(window.localStorage.getItem(AI_NOTION_KEY));
  } catch {
    return false;
  }
}

export function writeAiNotionPreference(on: boolean): void {
  try {
    window.localStorage.setItem(AI_NOTION_KEY, String(on));
  } catch {
    // localStorage를 쓸 수 없는 환경이면 이 화면을 열어 둔 동안만 유지한다
  }
}

/**
 * Notion을 켤 수 없는 이유. 켤 수 있으면 null. 브라우저 사용과 달리 아직 모르면(읽는 중) 막는다:
 * 서버가 연결을 확인해 줘야 쓸 수 있고, 켜 둔 채 보내도 서버가 도구를 알리지 않는다
 */
export function notionDisabledReason(capabilities: { notion?: AiNotionCapabilities } | undefined, isError: boolean): string | null {
  if (isError) return AI_NOTION_UNAVAILABLE_HINT;
  const notion = capabilities?.notion;
  if (!notion) return AI_NOTION_OFF_REASON;
  if (notion.available) return null;
  return notion.reason?.trim() || AI_NOTION_OFF_REASON;
}

/** Notion 도구가 진행 중일 때 줄에 붙는 말 */
export function notionToolRunningText(name: string): string | null {
  if (name === 'notion_search') return ' … 찾는 중';
  if (name === 'notion_read_page') return ' … 읽는 중';
  return null;
}

/** 끝난 Notion 도구 줄에 붙는 요약: 검색은 "결과 N건", 읽기는 "읽음"(제목은 사원이 쓴 글이라 이 줄에는 쓰지 않는다) */
export function notionToolDoneText(name: string, webSources: readonly AiWebSource[] | undefined): string | null {
  if (name === 'notion_search') {
    const count = webSources?.length ?? 0;
    return count > 0 ? `결과 ${count}건` : '결과 없음';
  }
  if (name === 'notion_read_page') return webSources?.length ? '읽음' : '읽지 못함';
  return null;
}

/** 카드·결과에 링크로 걸어도 되는 Notion 주소인지 (https Notion 호스트만) */
export function isNotionUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && ['notion.so', 'notion.site', 'notion.com'].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
