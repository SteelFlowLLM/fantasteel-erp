// 철강맨AI 보이는 마우스 (이슈 #425, 문서에 없는 기능). ERP 화면 조작이 누르기·채우기·고르기 전에 그 칸으로 커서를 움직이고 물결을 보인다.
// 서버 Chrome의 커서와 같은 모양이다. 화면에 그리기만 하고 마우스 이벤트는 받지 않는다(pointer-events: none).
// 움직임을 줄이도록 설정한 사용자에게는 움직이지 않고 바로 그 자리에 보인다.
// 첫 동작부터 답이 끝날 때까지(hideAiCursor) 마지막 자리에 계속 보인다 (이슈 #433).

/** 커서가 칸까지 움직이는 시간 (가정값) */
export const AI_CURSOR_MOVE_MS = 350;
const RIPPLE_MS = 450;
const ID = 'fantasteel-ai-cursor';

const CURSOR_SVG =
  '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 2l7.5 19 2.6-7.6L20.7 11z" fill="#f97316" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';

let position: { x: number; y: number } | null = null;

/** 요소 가운데 (화면 기준). 화면 밖이면 가장자리로 붙인다 */
export function cursorTarget(rect: { left: number; top: number; width: number; height: number }, viewport: { width: number; height: number }): { x: number; y: number } {
  const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(value, 0), max));
  return { x: clamp(rect.left + rect.width / 2, viewport.width), y: clamp(rect.top + rect.height / 2, viewport.height) };
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let layer: { root: HTMLElement; cursor: HTMLElement; ripple: HTMLElement } | null = null;

function ensureLayer(): { cursor: HTMLElement; ripple: HTMLElement } {
  if (layer?.root.isConnected) return layer;
  const root = document.createElement('div');
  root.id = ID;
  root.setAttribute('aria-hidden', 'true');
  // 화면 글(ui_snapshot)에 끼지 않게
  root.setAttribute('data-ai-skip', '');
  root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const ripple = document.createElement('div');
  ripple.style.cssText = 'position:absolute;left:0;top:0;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:9999px;border:3px solid #f97316;opacity:0;';
  const cursor = document.createElement('div');
  cursor.style.cssText = 'position:absolute;left:0;top:0;width:24px;height:24px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));transition:opacity .2s;';
  cursor.innerHTML = CURSOR_SVG;
  root.append(ripple, cursor);
  document.body.appendChild(root);
  layer = { root, cursor, ripple };
  return layer;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 커서를 요소로 움직이고 다 갈 때까지 기다린다. ripple이면 도착한 자리에 물결을 보인다.
 * 그리지 못해도(오래된 브라우저 등) 동작은 그대로 하도록 오류를 내지 않는다
 */
export async function moveAiCursorTo(element: HTMLElement, ripple = true): Promise<void> {
  try {
    const to = cursorTarget(element.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
    const { cursor, ripple: ring } = ensureLayer();
    const from = position ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const moveMs = reducedMotion() ? 0 : AI_CURSOR_MOVE_MS;
    cursor.style.opacity = '1';
    cursor.style.transition = 'opacity .2s';
    cursor.style.transform = `translate(${from.x}px, ${from.y}px)`;
    void cursor.getBoundingClientRect();
    cursor.style.transition = `opacity .2s, transform ${moveMs}ms cubic-bezier(.2,.7,.3,1)`;
    cursor.style.transform = `translate(${to.x}px, ${to.y}px)`;
    position = to;
    if (moveMs) await wait(moveMs);
    if (ripple && !reducedMotion() && typeof ring.animate === 'function') {
      ring.style.left = `${to.x}px`;
      ring.style.top = `${to.y}px`;
      ring.animate([{ opacity: 0.9, transform: 'scale(0.3)' }, { opacity: 0, transform: 'scale(1.4)' }], { duration: RIPPLE_MS, easing: 'ease-out' });
    }
  } catch {
    // 커서는 보이기만 하는 것이라 실패해도 동작을 막지 않는다
  }
}

/** 답이 끝났을 때 커서를 숨긴다. 다음 답의 첫 동작은 이 자리에서 이어서 움직인다 */
export function hideAiCursor(): void {
  if (layer?.root.isConnected) layer.cursor.style.opacity = '0';
}
