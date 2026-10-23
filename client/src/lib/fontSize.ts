// 글자 크기 설정 (보통·크게·아주 크게). 브라우저 확대처럼 화면 전체를 zoom으로 키운다 — globals.css의 html[data-font-size].
// 사원별이 아니라 이 브라우저에 저장한다 (계정에 저장할 컬럼이 ERD에 없다).

export const FONT_SIZES = ['normal', 'large', 'xlarge'] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const FONT_SIZE_LABEL: Record<FontSize, string> = {
  normal: '보통',
  large: '크게',
  xlarge: '아주 크게',
};

export const FONT_SIZE_KEY = 'fantasteel.font-size';

export function isFontSize(value: unknown): value is FontSize {
  return typeof value === 'string' && (FONT_SIZES as readonly string[]).includes(value);
}

export function readFontSize(): FontSize {
  try {
    if (typeof window === 'undefined') return 'normal';
    const value = window.localStorage.getItem(FONT_SIZE_KEY);
    return isFontSize(value) ? value : 'normal';
  } catch {
    return 'normal';
  }
}

export function writeFontSize(fontSize: FontSize): void {
  try {
    if (fontSize === 'normal') window.localStorage.removeItem(FONT_SIZE_KEY);
    else window.localStorage.setItem(FONT_SIZE_KEY, fontSize);
  } catch {
    // localStorage를 쓸 수 없는 환경이면 이 탭에서만 적용한다
  }
}

export function applyFontSize(fontSize: FontSize): void {
  if (fontSize === 'normal') delete document.documentElement.dataset.fontSize;
  else document.documentElement.dataset.fontSize = fontSize;
}

/**
 * 지금 화면 확대 비율. zoom 안에서 getBoundingClientRect는 확대된 좌표를 돌려주므로,
 * 그 값을 style의 px로 다시 쓸 때는 이 비율로 나눠야 한 번 더 확대되지 않는다.
 */
export function appZoom(): number {
  const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

// 첫 화면을 그리기 전에 <html>에 설정을 달아, 작은 글자로 그렸다가 커지는 깜빡임을 막는다 (layout.tsx의 <head>).
export const FONT_SIZE_BOOT_SCRIPT = `try{var v=localStorage.getItem('${FONT_SIZE_KEY}');if(v==='large'||v==='xlarge')document.documentElement.dataset.fontSize=v}catch(e){}`;
