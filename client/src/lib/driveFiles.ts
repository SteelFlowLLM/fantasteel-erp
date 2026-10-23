// Drive 파일 도우미: 종류 이름, 미리보기 방식, 내려받을 때의 이름·MIME, 내용 주소 (이슈 #392).
// 서버가 Google 문서·스프레드시트·프레젠테이션을 PDF로 내보내 보내므로, 받은 파일의 이름·MIME은 원본이 아니라 그 PDF 기준이다 (server driveDelivery와 같은 규칙).
import { AI_IMAGE_MEDIA_TYPES, type DriveFileListKind, type DriveFileView } from '@fantasteel/shared';
import { fmtBytes } from '@/lib/format';

export const DRIVE_KIND_LABEL: Record<DriveFileListKind, string> = { all: '전체', image: '사진', audio: '녹음', document: '문서' };

/** 화면 탭 순서: 전체 · 사진 · 녹음 · 문서 */
export const DRIVE_KIND_TAB_ORDER: readonly DriveFileListKind[] = ['all', 'image', 'audio', 'document'];

export type DrivePreviewType = 'image' | 'audio' | 'pdf';

const GOOGLE_NATIVE_PREFIX = 'application/vnd.google-apps.';
/** 브라우저가 그릴 수 있는 사진. HEIC·HEIF·TIFF는 Safari만 그려서 내려받기로 둔다 */
const BROWSER_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];

function mimeOf(file: Pick<DriveFileView, 'mimeType'>): string {
  return file.mimeType.split(';')[0].trim().toLowerCase();
}

export function isGoogleNativeDoc(file: Pick<DriveFileView, 'mimeType'>): boolean {
  return mimeOf(file).startsWith(GOOGLE_NATIVE_PREFIX);
}

/** 내려받는 파일의 MIME: Google 문서류는 PDF */
export function driveDeliveredMime(file: Pick<DriveFileView, 'mimeType'>): string {
  return isGoogleNativeDoc(file) ? 'application/pdf' : file.mimeType;
}

/** 내려받는 파일의 이름: Google 문서류는 끝에 .pdf */
export function driveDeliveredName(file: Pick<DriveFileView, 'mimeType' | 'name'>): string {
  if (!isGoogleNativeDoc(file)) return file.name;
  return /\.pdf$/i.test(file.name) ? file.name : `${file.name}.pdf`;
}

/** 내려받지 않고 화면에서 바로 볼 수 있는 방식. 없으면 내려받기만 된다 */
export function drivePreviewType(file: Pick<DriveFileView, 'kind' | 'mimeType'>): DrivePreviewType | null {
  const mime = mimeOf(file);
  if (file.kind === 'audio') return 'audio';
  if (file.kind === 'image') return BROWSER_IMAGE_MIME_TYPES.includes(mime) ? 'image' : null;
  return mime === 'application/pdf' || isGoogleNativeDoc(file) ? 'pdf' : null;
}

/** 목록 한 줄의 종류 표시. 문서는 PDF·Google·Office로 나눠 보인다 */
export function driveKindLabel(file: Pick<DriveFileView, 'kind' | 'mimeType'>): string {
  if (file.kind === 'image') return '사진';
  if (file.kind === 'audio') return '녹음';
  const mime = mimeOf(file);
  if (mime === 'application/pdf') return 'PDF';
  if (mime === 'application/vnd.google-apps.document') return 'Google 문서';
  if (mime === 'application/vnd.google-apps.spreadsheet') return 'Google 스프레드시트';
  if (mime === 'application/vnd.google-apps.presentation') return 'Google 프레젠테이션';
  if (mime.includes('wordprocessingml')) return 'Word';
  if (mime.includes('spreadsheetml')) return 'Excel';
  if (mime.includes('presentationml')) return 'PowerPoint';
  // 글 파일(텍스트·마크다운·CSV)은 철강맨AI가 읽으려고 목록에 넣었다 (이슈 #398 2단계)
  if (mime.startsWith('text/')) return '글 파일';
  return '문서';
}

/** 서버 경로(/api/v1 뒤): 파일 내용. download면 저장하게 한다 */
export function driveContentPath(fileId: string, options: { download?: boolean } = {}): string {
  const base = `/integrations/google-drive/files/${encodeURIComponent(fileId)}/content`;
  return options.download ? `${base}?download=1` : base;
}

/** 서버 응답을 올리기·AI 입력에 넣을 File로. 이름과 MIME은 위 규칙을 따른다 */
export function driveBlobToFile(blob: Blob, file: Pick<DriveFileView, 'mimeType' | 'name'>): File {
  return new File([blob], driveDeliveredName(file), { type: driveDeliveredMime(file) });
}

/** 크기 줄. Drive가 크기를 주지 않는 Google 문서는 "크기 모름" 대신 종류만 보인다 */
export function driveSizeText(file: Pick<DriveFileView, 'kind' | 'mimeType' | 'size'>): string {
  if (file.size !== null) return fmtBytes(file.size);
  return isGoogleNativeDoc(file) ? '-' : '크기 모름';
}

/** 철강맨AI 입력에 붙일 수 있는 사진인지(붙이는 형식은 로컬 사진과 같다: PNG·JPEG·WebP). 안 되면 한국어 이유 */
export function driveAiImageProblem(file: Pick<DriveFileView, 'mimeType'>): string | null {
  return (AI_IMAGE_MEDIA_TYPES as readonly string[]).includes(mimeOf(file)) ? null : 'PNG, JPEG, WebP 사진만 붙일 수 있어요';
}

/** 크기 상한(maxBytes)을 알 수 있을 때 넘는 파일의 이유. 크기를 모르는 파일(Google 문서류)은 받은 뒤 확인한다 */
export function driveSizeProblem(file: Pick<DriveFileView, 'size'>, maxBytes: number): string | null {
  if (file.size !== null && file.size > maxBytes) return `${fmtBytes(maxBytes).replace(/\.0 /, '')}를 넘어서 첨부할 수 없어요`;
  return null;
}
