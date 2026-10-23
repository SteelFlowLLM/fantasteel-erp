// 브리핑 장면별 철강맨 그림. 진행 장면은 철강맨AI 패널과 같은 상황별 모션(public/steelman-ai),
// 카드 표정은 24px 눈 버전 기분 모션(docs/character/steelman-pixel/motion → public/steelman-ai/mood)이다.
import type { BriefingSeverity } from '@/features/briefing/lib/briefingRules';
import { steelmanSpriteSrc } from '@/lib/steelmanStatus';

export type BriefingFace = 'greet' | 'thinking' | 'searching' | 'reading' | 'found' | 'done' | 'listening' | BriefingSeverity;

export const BRIEFING_STILL_SRC = '/steelman-ai/still.png';

/** 위험 = 놀람(!), 확인 필요 = 물음표, 참고 = 말하기, 좋은 소식 = 기쁨 */
const MOOD_SRC: Record<BriefingSeverity, string> = {
  danger: '/steelman-ai/mood/05_surprised.gif',
  wait: '/steelman-ai/11_unknown_A.gif',
  run: '/steelman-ai/mood/08_talk.gif',
  ok: '/steelman-ai/mood/03_happy.gif',
};

/** 같은 사원이면 같은 시안(A/B/C)이 나오게 seed로 고른다 */
export function briefingFaceSrc(face: BriefingFace, seed: string): string {
  if (face === 'danger' || face === 'wait' || face === 'run' || face === 'ok') return MOOD_SRC[face];
  return steelmanSpriteSrc(face, `briefing:${seed}`);
}

/** 미리 읽어 둘 그림 (표정이 바뀔 때 빈 칸이 보이지 않게) */
export function briefingFaceSources(seed: string): string[] {
  const faces: BriefingFace[] = ['greet', 'thinking', 'searching', 'reading', 'found', 'done', 'listening', 'danger', 'wait', 'run', 'ok'];
  return faces.map((face) => briefingFaceSrc(face, seed));
}
