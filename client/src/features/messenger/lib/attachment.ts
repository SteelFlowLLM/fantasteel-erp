// 첨부 미리보기: ERD에 형식(MIME) 컬럼이 없어 파일 이름의 확장자로 이미지를 판단한다.
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

const extensionOf = (name: string) => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '');

/** 미리보기할 수 있는 그림 파일의 형식. 아니면 null (SVG는 스크립트가 들어갈 수 있어 미리보지 않는다) */
export function imageMimeOf(name: string): string | null {
  return IMAGE_MIME[extensionOf(name)] ?? null;
}
