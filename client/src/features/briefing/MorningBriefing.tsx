'use client';

// 철강맨 아침 브리핑 바깥 틀 (셸에 하나). 로그인할 때마다 한 번 열고, 닫으면 철강맨이 작아져 오른쪽 아래 단추로 날아간다.
// 단추를 누르면 다시 열리고, 철강맨AI 채팅의 /브리핑 명령은 처음부터 다시 들려준다(useBriefingStore.openBriefing).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BriefingDialog } from '@/features/briefing/BriefingDialog';
import { BriefingFaceImage } from '@/features/briefing/BriefingFaceImage';
import { useMe } from '@/hooks/useMe';
import { cn } from '@/lib/cn';
import { takeBriefingAfterLogin, useBriefingStore } from '@/stores/useBriefingStore';

/** 오른쪽 아래 단추 크기와 가장자리 여백 (px) */
const DOCK_SIZE = 72;
const DOCK_GAP = 24;
const FLIGHT_MS = 600;
const HINT_MS = 2_600;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 글자 크기 설정이 html zoom이라, 화면 좌표(getBoundingClientRect·innerWidth)를 CSS px로 바꿀 때 나눈다 */
function appZoom(): number {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-zoom'));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function MorningBriefing() {
  const me = useMe();
  const open = useBriefingStore((s) => s.open);
  const docked = useBriefingStore((s) => s.docked);
  const summary = useBriefingStore((s) => s.summary);
  const openBriefing = useBriefingStore((s) => s.openBriefing);
  const reopenBriefing = useBriefingStore((s) => s.reopenBriefing);
  const closeBriefing = useBriefingStore((s) => s.closeBriefing);
  const hydrateDocked = useBriefingStore((s) => s.hydrateDocked);
  const [ready, setReady] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [flight, setFlight] = useState<{ box: Box; to: Box; moving: boolean } | null>(null);
  const [hint, setHint] = useState(false);
  const seed = String(me.employeeId);

  // 로그인 직후 표시가 있으면 연다. 새로고침·새 탭 자동 로그인에는 표시가 없어 열지 않는다
  useEffect(() => {
    setReady(true);
    hydrateDocked();
    if (takeBriefingAfterLogin()) openBriefing();
  }, [me.employeeId, hydrateDocked, openBriefing]);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // 철강맨 그림 자리에 한 번 그린 뒤 단추 자리로 옮겨야 transition이 걸린다. 레이아웃을 한 번 읽어 처음 자리를 확정한다
  // (requestAnimationFrame은 가려진 탭에서 멈춰 철강맨이 화면에 남는다)
  const flyerRef = useRef<HTMLDivElement>(null);
  const flying = flight !== null;
  const moving = flight?.moving ?? false;
  useEffect(() => {
    if (!flying || moving) return;
    flyerRef.current?.getBoundingClientRect();
    setFlight((f) => (f ? { ...f, moving: true } : f));
  }, [flying, moving]);

  useEffect(() => {
    if (!moving) return;
    const timer = setTimeout(() => {
      setFlight(null);
      setHint(true);
    }, FLIGHT_MS);
    return () => clearTimeout(timer);
  }, [moving]);

  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(timer);
  }, [hint]);

  const close = (stage: DOMRect | null) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (stage && stage.width > 0 && !reduce) {
      const zoom = appZoom();
      const box = { left: stage.left / zoom, top: stage.top / zoom, width: stage.width / zoom, height: stage.height / zoom };
      const to = { left: window.innerWidth / zoom - DOCK_GAP - DOCK_SIZE, top: window.innerHeight / zoom - DOCK_GAP - DOCK_SIZE, width: DOCK_SIZE, height: DOCK_SIZE };
      setFlight({ box, to, moving: false });
    } else {
      setHint(true);
    }
    closeBriefing();
  };

  if (!ready) return null;
  const showDock = docked && !open && !flight;
  const flyBox = flight ? (flight.moving ? flight.to : flight.box) : null;

  return createPortal(
    <>
      {mounted ? <BriefingDialog open={open} onClose={close} /> : null}
      {flyBox ? (
        <div
          ref={flyerRef}
          aria-hidden="true"
          className="briefing-flyer pointer-events-none fixed z-[60] overflow-hidden rounded-xl bg-nav-dark"
          // 날아가는 동안 위치·크기가 매 프레임 바뀌어 style로 준다
          style={{ left: flyBox.left, top: flyBox.top, width: flyBox.width, height: flyBox.height }}
        >
          <BriefingFaceImage face="listening" seed={seed} size={192} className="size-full!" />
        </div>
      ) : null}
      {showDock ? (
        <button
          type="button"
          aria-label="철강맨 아침 브리핑 다시 열기"
          className="group briefing-dock-in fixed right-6 bottom-6 z-[45] size-18 rounded-xl bg-nav-dark p-0 shadow-[0_8px_22px_rgba(10,16,24,0.35),0_0_0_3px_#fff] transition-transform hover:-translate-y-0.5"
          onClick={reopenBriefing}
        >
          <span className="block size-18 overflow-hidden rounded-xl">
            <BriefingFaceImage face="listening" seed={seed} size={DOCK_SIZE} />
          </span>
          {summary ? (
            <span
              aria-hidden="true"
              className={cn(
                'absolute -top-[7px] -right-[7px] grid h-5.5 min-w-5.5 place-items-center rounded-full px-1.5 text-xs font-extrabold text-white shadow-[0_0_0_2px_#fff]',
                summary.alert ? 'bg-danger' : 'bg-ok',
              )}
            >
              {summary.count}
            </span>
          ) : null}
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute top-1/2 right-[calc(100%+12px)] -translate-y-1/2 whitespace-nowrap border-2 border-nav-dark bg-surface px-2.5 py-1 text-xs text-ink shadow-[3px_3px_0_rgba(27,37,49,0.15)] transition-opacity',
              hint ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
            )}
          >
            오늘 브리핑 다시 볼까요?
          </span>
        </button>
      ) : null}
    </>,
    document.body,
  );
}
