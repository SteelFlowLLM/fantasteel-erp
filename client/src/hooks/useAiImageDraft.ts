// 질문 칸에 붙여 둔 사진(아직 보내지 않은 것). 파일·붙여넣기·끌어놓기·화면 캡처가 모두 같은 준비 과정을 거친다.
import { AI_IMAGE_MAX_COUNT } from '@fantasteel/shared';
import { useCallback, useRef, useState } from 'react';
import { captureAppScreen } from '@/lib/aiCapture';
import { AiImageError, isAiImageFile, prepareAiImage, type PreparedAiImage } from '@/lib/aiImage';

export interface AiImageNotice {
  text: string;
  /** 사진을 붙이지 못한 오류면 true, 안내(장수 상한 등)면 false */
  error: boolean;
}

export const AI_IMAGE_LIMIT_NOTICE = `사진은 한 번에 ${AI_IMAGE_MAX_COUNT}장까지 붙일 수 있어요`;

export function useAiImageDraft() {
  const [images, setImages] = useState<PreparedAiImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<AiImageNotice | null>(null);
  // 여러 장을 연달아 처리하는 동안에도 다시 그리기를 기다리지 않고 최신 목록을 보려고 상태와 함께 든다
  const imagesRef = useRef<PreparedAiImage[]>([]);

  const commit = useCallback((next: PreparedAiImage[]) => {
    imagesRef.current = next;
    setImages(next);
  }, []);

  const add = useCallback(
    async (prepare: () => Promise<PreparedAiImage>): Promise<void> => {
      if (imagesRef.current.length >= AI_IMAGE_MAX_COUNT) {
        setNotice({ text: AI_IMAGE_LIMIT_NOTICE, error: false });
        return;
      }
      setBusy(true);
      setNotice(null);
      try {
        const image = await prepare();
        // 준비하는 동안 다른 경로로 가득 찼으면 늦게 끝난 사진은 버린다
        if (imagesRef.current.length >= AI_IMAGE_MAX_COUNT) setNotice({ text: AI_IMAGE_LIMIT_NOTICE, error: false });
        else commit([...imagesRef.current, image]);
      } catch (error) {
        setNotice({ text: error instanceof AiImageError ? error.message : '사진을 붙이지 못했어요', error: true });
      } finally {
        setBusy(false);
      }
    },
    [commit],
  );

  /** 사진 파일 여러 장. 이미지가 아닌 파일은 건너뛰고, 붙일 사진이 하나도 없으면 알린다 */
  const addFiles = useCallback(
    async (files: readonly File[]): Promise<void> => {
      const photos = files.filter(isAiImageFile);
      if (!photos.length) {
        setNotice({ text: 'PNG, JPEG, WebP 사진만 붙일 수 있어요', error: true });
        return;
      }
      for (const photo of photos) {
        // 한 장씩 차례로 붙여야 상한 판단이 어긋나지 않는다
        await add(() => prepareAiImage(photo));
      }
    },
    [add],
  );

  const addCapture = useCallback(() => add(captureAppScreen), [add]);

  const remove = useCallback(
    (index: number) => {
      commit(imagesRef.current.filter((_, i) => i !== index));
      setNotice(null);
    },
    [commit],
  );

  const clear = useCallback(() => {
    commit([]);
    setNotice(null);
  }, [commit]);

  /** 사진을 붙이지 못한 이유를 사진 줄 아래에 보인다 (예: 모델이 사진을 볼 수 없음) */
  const warn = useCallback((text: string) => setNotice({ text, error: true }), []);

  return { images, busy, notice, addFiles, addCapture, remove, clear, warn };
}
