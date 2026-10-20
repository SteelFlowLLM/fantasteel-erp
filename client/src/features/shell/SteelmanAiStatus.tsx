'use client';

// 철강맨AI 패널의 상황별 철강맨 (이슈 #414). 24px 도트를 2배(48px)로 보인다. 그림은 192px(8배)라 1/4로 줄이는 정수 배율이고,
// pixelated로 칸이 번지지 않게 한다. 움직임 줄이기 설정이면 움직이지 않는 얼굴을 보인다. 꾸밈이라 화면 읽기에서는 숨긴다(상황은 글로도 보인다).
import { cn } from '@/lib/cn';
import { steelmanSpriteSrc, type SteelmanStatus } from '@/lib/steelmanStatus';

const STILL_SRC = '/steelman-ai/still.png';

/**
 * status가 없으면 가만히 있는 얼굴. seedKey가 같으면 같은 시안이다.
 * md = 대화 옆(2배, 48px), sm = 패널 머리(1배, 24px를 기존 철강맨AI 칸 크기 안에)
 */
export function SteelmanAiStatus({ status, seedKey, size = 'md', className }: { status: SteelmanStatus | null; seedKey: string; size?: 'sm' | 'md'; className?: string }) {
  const src = status ? steelmanSpriteSrc(status, seedKey) : STILL_SRC;
  const px = size === 'md' ? 48 : 24;
  return (
    <span
      aria-hidden="true"
      data-steelman-status={status ?? 'idle'}
      className={cn('inline-flex flex-none items-center justify-center rounded-md bg-steelman-soft', size === 'md' ? 'size-12' : 'h-9 w-10', className)}
    >
      <picture className="block">
        {status ? <source srcSet={STILL_SRC} media="(prefers-reduced-motion: reduce)" /> : null}
        <img src={src} alt="" width={px} height={px} draggable={false} className="block [image-rendering:pixelated]" style={{ width: px, height: px }} />
      </picture>
    </span>
  );
}
