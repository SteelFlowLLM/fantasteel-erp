// 브리핑 철강맨 그림 한 장. 192px(8배) GIF를 정수 배율로 줄여 pixelated로 그리고, 움직임 줄이기 설정이면 가만히 있는 얼굴을 보인다.
// 꾸밈이라 화면 읽기에서는 숨긴다(상황은 글로도 보인다).
import { forwardRef } from 'react';
import { BRIEFING_STILL_SRC, briefingFaceSrc, type BriefingFace } from '@/features/briefing/lib/briefingFaces';
import { cn } from '@/lib/cn';

export const BriefingFaceImage = forwardRef<HTMLImageElement, { face: BriefingFace; seed: string; size: number; className?: string }>(function BriefingFaceImage(
  { face, seed, size, className },
  ref,
) {
  return (
    <picture className="block">
      <source srcSet={BRIEFING_STILL_SRC} media="(prefers-reduced-motion: reduce)" />
      <img
        ref={ref}
        src={briefingFaceSrc(face, seed)}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        draggable={false}
        className={cn('block [image-rendering:pixelated]', className)}
        style={{ width: size, height: size }}
      />
    </picture>
  );
});
