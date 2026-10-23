// 철강맨AI에 붙이는 사진 준비. 모델에 보내기 전에 긴 변을 줄이고 JPEG로 다시 인코딩해 서버 상한(AI_IMAGE_MAX_BYTES) 안에 넣는다.
// 순수 계산(크기·바이트·형식 확인)과 브라우저 API를 쓰는 부분(디코딩·캔버스)을 나눠, 앞쪽만 단위 테스트한다.
import { AI_IMAGE_MAX_BYTES, AI_IMAGE_MEDIA_TYPES, type AiAssistantImageInput } from '@fantasteel/shared';

/** 모델이 보는 사진의 긴 변 상한(px). 이보다 크게 보내도 모델이 다시 줄이므로 전송량만 늘어난다 */
export const AI_IMAGE_MAX_SIDE = 1568;
const JPEG_QUALITY = 0.85;
/** 첫 인코딩이 상한을 넘을 때 한 번만 다시 시도하는 품질 */
const JPEG_RETRY_QUALITY = 0.6;

/** 붙일 사진 한 장. 화면 미리보기는 같은 데이터로 만든 data URL을 쓰므로 따로 들고 있지 않는다 */
export interface PreparedAiImage extends AiAssistantImageInput {
  width: number;
  height: number;
  /** Drive에서 가져온 사진이면 그 파일 id. 서버가 답의 Drive 출처로 보이게 함께 보낸다 (사진 내용은 images로 간다) */
  driveFileId?: string;
}

export class AiImageError extends Error {}

/** 긴 변이 maxSide를 넘으면 비율을 지켜 줄인 크기. 작은 사진은 키우지 않는다 */
export function fitWithinSide(width: number, height: number, maxSide: number = AI_IMAGE_MAX_SIDE): { width: number; height: number } {
  const longSide = Math.max(width, height);
  if (longSide <= maxSide) return { width, height };
  const scale = maxSide / longSide;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** base64 글자에서 디코딩한 바이트 수 (서버가 AI_IMAGE_MAX_BYTES를 재는 기준과 같다) */
export function base64ByteSize(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** 붙일 수 있는 사진 형식인지. 인코딩 단계에서 JPEG로 바꾸므로 읽을 수 있는 이미지면 받는다 */
export function isAiImageFile(file: { type: string }): boolean {
  return (AI_IMAGE_MEDIA_TYPES as readonly string[]).includes(file.type);
}

/** 화면에 보일 data URL */
export const aiImageDataUrl = (image: AiAssistantImageInput): string => `data:${image.mediaType};base64,${image.dataBase64}`;

/** 바이트를 base64로. btoa에 한 번에 넣으면 큰 사진에서 인자 수 한도를 넘어 조각으로 나눈다 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new AiImageError('사진을 변환하지 못했어요'))), 'image/jpeg', quality);
  });
}

/** 원본 캔버스(또는 디코딩한 사진)를 긴 변 상한에 맞춰 줄여 JPEG로 인코딩한다. 상한을 넘으면 품질을 낮춰 한 번만 다시 한다 */
async function encodeScaled(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): Promise<PreparedAiImage> {
  const { width, height } = fitWithinSide(sourceWidth, sourceHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new AiImageError('사진을 변환하지 못했어요');
  // JPEG에는 투명이 없어 투명한 PNG가 검게 나오지 않게 흰 바탕을 깐다
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  let blob = await canvasToBlob(canvas, JPEG_QUALITY);
  if (blob.size > AI_IMAGE_MAX_BYTES) blob = await canvasToBlob(canvas, JPEG_RETRY_QUALITY);
  if (blob.size > AI_IMAGE_MAX_BYTES) throw new AiImageError('사진이 너무 커요. 더 작은 사진을 붙여 주세요');
  return { mediaType: 'image/jpeg', dataBase64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())), width, height };
}

/** 사진 파일·붙여넣은 이미지를 모델에 보낼 형태로 만든다 */
export async function prepareAiImage(file: Blob): Promise<PreparedAiImage> {
  if (!isAiImageFile(file)) throw new AiImageError('PNG, JPEG, WebP 사진만 붙일 수 있어요');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AiImageError('사진을 열 수 없어요. 다른 사진을 붙여 주세요');
  }
  try {
    return await encodeScaled(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/** 화면 캡처처럼 이미 그려진 캔버스를 모델에 보낼 형태로 만든다 */
export async function prepareAiImageFromCanvas(canvas: HTMLCanvasElement): Promise<PreparedAiImage> {
  if (canvas.width === 0 || canvas.height === 0) throw new AiImageError('화면을 캡처하지 못했어요');
  return await encodeScaled(canvas, canvas.width, canvas.height);
}
