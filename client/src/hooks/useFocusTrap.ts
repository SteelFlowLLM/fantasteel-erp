'use client';

// 겹창(aria-modal) 초점 처리: 열리면 창으로 초점을 옮기고, Tab이 창 밖으로 나가지 않게 가두고, 닫히면 원래 자리로 돌려준다.
// session = 창이 열려 있는 동안, trap = 그중 Tab을 가둘 때 (위에 다른 창이 떠 있으면 끈다)
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, session: boolean, trap: boolean = session): void {
  const saved = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!session) return;
    // 개발 모드가 효과를 두 번 돌릴 때 이미 창 안으로 옮긴 초점을 '원래 자리'로 착각하지 않는다
    const active = document.activeElement;
    const previous = active instanceof HTMLElement && !ref.current?.contains(active) ? active : saved.current;
    saved.current = previous;
    ref.current?.focus({ preventScroll: true });
    return () => {
      const current = document.activeElement;
      // 그 사이 다른 곳(예: 새로 열린 패널)이 초점을 가져갔으면 뺏지 않는다
      const free = !current || current === document.body || Boolean(ref.current?.contains(current));
      if (free && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [ref, session]);

  useEffect(() => {
    if (!session || !trap) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const container = ref.current;
      if (event.key !== 'Tab' || !container) return;
      const items = focusables(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && container.contains(active);
      if (!inside || (event.shiftKey && (active === first || active === container))) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [ref, session, trap]);
}
