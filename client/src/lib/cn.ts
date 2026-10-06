const HOVER_BG = 'hover:bg-';

/**
 * 조건부 class 이름을 이어 붙인다.
 * 같은 요소에 `hover:bg-*`가 둘 이상이면 뒤에 쓴 것만 남긴다. 목록 항목에 기본 hover(`hover:bg-surface-2`)와
 * 선택 상태 hover(`hover:bg-brand-tint-hover`)를 함께 줄 때 CSS 순서에 따라 선택색이 회색으로 덮이는 것을 막는다.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  const tokens = parts
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);
  const lastHoverBg = tokens.reduce((last, token, index) => (token.startsWith(HOVER_BG) ? index : last), -1);
  return tokens.filter((token, index) => !token.startsWith(HOVER_BG) || index === lastHoverBg).join(' ');
}
