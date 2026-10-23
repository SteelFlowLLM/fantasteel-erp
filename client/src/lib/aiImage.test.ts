// 철강맨AI 사진 준비의 순수 계산: 줄일 크기, base64 바이트 수, 형식 확인.
import { describe, expect, it } from 'vitest';
import { AI_IMAGE_MAX_SIDE, aiImageDataUrl, base64ByteSize, bytesToBase64, fitWithinSide, isAiImageFile } from '@/lib/aiImage';

describe('fitWithinSide', () => {
  it('긴 변이 상한 안이면 그대로 둔다 (키우지 않는다)', () => {
    expect(fitWithinSide(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithinSide(AI_IMAGE_MAX_SIDE, 100)).toEqual({ width: AI_IMAGE_MAX_SIDE, height: 100 });
  });

  it('가로가 길면 가로를 상한에 맞추고 비율을 지킨다', () => {
    expect(fitWithinSide(3136, 1568)).toEqual({ width: 1568, height: 784 });
  });

  it('세로가 길면 세로를 상한에 맞춘다', () => {
    expect(fitWithinSide(1000, 3136)).toEqual({ width: 500, height: 1568 });
  });

  it('아주 가느다란 사진도 한 변이 0px이 되지 않는다', () => {
    expect(fitWithinSide(20000, 2)).toEqual({ width: 1568, height: 1 });
  });

  it('상한을 직접 줄 수 있다', () => {
    expect(fitWithinSide(400, 200, 100)).toEqual({ width: 100, height: 50 });
  });
});

describe('base64ByteSize', () => {
  it('패딩(=)을 빼고 디코딩한 바이트 수를 센다', () => {
    expect(base64ByteSize('')).toBe(0);
    expect(base64ByteSize(btoa('a'))).toBe(1); // YQ==
    expect(base64ByteSize(btoa('ab'))).toBe(2); // YWI=
    expect(base64ByteSize(btoa('abc'))).toBe(3); // YWJj
    expect(base64ByteSize(btoa('x'.repeat(1000)))).toBe(1000);
  });
});

describe('bytesToBase64', () => {
  it('조각으로 나누는 큰 데이터도 btoa 한 번과 같은 결과다', () => {
    const bytes = Uint8Array.from({ length: 0x8000 * 2 + 5 }, (_, i) => i % 256);
    const expected = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
    expect(bytesToBase64(bytes)).toBe(expected);
    expect(base64ByteSize(bytesToBase64(bytes))).toBe(bytes.length);
  });
});

describe('isAiImageFile', () => {
  it('PNG·JPEG·WebP만 받는다', () => {
    expect(isAiImageFile({ type: 'image/png' })).toBe(true);
    expect(isAiImageFile({ type: 'image/jpeg' })).toBe(true);
    expect(isAiImageFile({ type: 'image/webp' })).toBe(true);
    expect(isAiImageFile({ type: 'image/gif' })).toBe(false);
    expect(isAiImageFile({ type: 'application/pdf' })).toBe(false);
    expect(isAiImageFile({ type: '' })).toBe(false);
  });
});

describe('aiImageDataUrl', () => {
  it('형식과 base64로 data URL을 만든다', () => {
    expect(aiImageDataUrl({ mediaType: 'image/jpeg', dataBase64: 'QUJD' })).toBe('data:image/jpeg;base64,QUJD');
  });
});
