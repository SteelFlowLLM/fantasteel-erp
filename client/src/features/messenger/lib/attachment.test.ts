// 첨부 미리보기 판단: 확장자(대소문자 무시)로 그림만, SVG·확장자 없음은 제외.
import { describe, expect, it } from 'vitest';
import { imageMimeOf } from '@/features/messenger/lib/attachment';

describe('imageMimeOf', () => {
  it('그림 확장자는 형식을, 나머지는 null', () => {
    expect(imageMimeOf('불량 사진.JPG')).toBe('image/jpeg');
    expect(imageMimeOf('a.png')).toBe('image/png');
    expect(imageMimeOf('도면.svg')).toBeNull();
    expect(imageMimeOf('성적서.pdf')).toBeNull();
    expect(imageMimeOf('README')).toBeNull();
  });
});
