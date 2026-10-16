// 지금 ERP 화면을 사진으로 찍어 철강맨AI에 붙인다. 브라우저에서만 돈다.
import { AiImageError, prepareAiImageFromCanvas, type PreparedAiImage } from '@/lib/aiImage';

/** 캡처할 영역: AppFrame이 상단 바와 본문을 감싼 칸에 단 표시 */
const CAPTURE_ROOT = '[data-ai-capture]';

/** 철강맨AI 패널(자기 대화가 찍히면 안 된다)과 펫(화면 위에 떠 있는 장식)은 사진에서 뺀다 */
const CAPTURE_EXCLUDED = 'aside[aria-label="철강맨AI"], [data-pet-avoid], [data-fantapet]';

/** html-to-image의 filter: true면 그린다 */
export function shouldCaptureNode(node: Node): boolean {
  return !(node instanceof Element && node.matches(CAPTURE_EXCLUDED));
}

export async function captureAppScreen(): Promise<PreparedAiImage> {
  const root = document.querySelector<HTMLElement>(CAPTURE_ROOT);
  if (!root) throw new AiImageError('캡처할 화면을 찾지 못했어요');
  try {
    // 라이브러리는 캡처할 때만 쓰므로 패널을 열 때 내려받지 않는다
    const { toCanvas } = await import('html-to-image');
    // 어차피 긴 변을 줄여 보내므로 화면 배율을 곱하지 않는다
    const canvas = await toCanvas(root, { pixelRatio: 1, filter: shouldCaptureNode, backgroundColor: '#fff' });
    return await prepareAiImageFromCanvas(canvas);
  } catch (error) {
    if (error instanceof AiImageError) throw error;
    throw new AiImageError('화면을 캡처하지 못했어요. 사진을 직접 붙여 주세요');
  }
}
