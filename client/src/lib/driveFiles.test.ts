// Drive 파일 도우미 (이슈 #392): 미리보기 방식, 내려받는 이름·MIME, 내용 주소
import type { DriveFileView } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { DRIVE_KIND_LABEL, DRIVE_KIND_TAB_ORDER, driveAiImageProblem, driveBlobToFile, driveContentPath, driveDeliveredMime, driveDeliveredName, driveKindLabel, drivePreviewType, driveSizeText } from '@/lib/driveFiles';

const file = (overrides: Partial<DriveFileView> = {}): DriveFileView => ({
  id: 'f1',
  name: '파일',
  mimeType: 'application/pdf',
  kind: 'document',
  size: 1024,
  modifiedTime: null,
  thumbnailLink: null,
  ...overrides,
});

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('drivePreviewType', () => {
  it('사진은 브라우저가 그리는 형식만 바로 보고, HEIC·TIFF는 내려받기만', () => {
    for (const mimeType of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'IMAGE/JPEG']) {
      expect(drivePreviewType(file({ kind: 'image', mimeType }))).toBe('image');
    }
    for (const mimeType of ['image/heic', 'image/heif', 'image/tiff']) {
      expect(drivePreviewType(file({ kind: 'image', mimeType }))).toBeNull();
    }
  });

  it('녹음은 재생, PDF·Google 문서류는 PDF로 보고, Office는 내려받기만', () => {
    expect(drivePreviewType(file({ kind: 'audio', mimeType: 'audio/mp4' }))).toBe('audio');
    expect(drivePreviewType(file({ kind: 'audio', mimeType: 'video/webm' }))).toBe('audio');
    expect(drivePreviewType(file())).toBe('pdf');
    expect(drivePreviewType(file({ mimeType: 'application/vnd.google-apps.spreadsheet' }))).toBe('pdf');
    expect(drivePreviewType(file({ mimeType: DOCX }))).toBeNull();
  });
});

describe('내려받는 이름·MIME', () => {
  it('Google 문서류는 PDF이므로 이름 끝에 .pdf를 붙인다 (이미 있으면 그대로)', () => {
    const doc = file({ name: '회의 안건', mimeType: 'application/vnd.google-apps.document' });
    expect(driveDeliveredName(doc)).toBe('회의 안건.pdf');
    expect(driveDeliveredMime(doc)).toBe('application/pdf');
    expect(driveDeliveredName({ ...doc, name: '계약서.PDF' })).toBe('계약서.PDF');
  });

  it('그 밖의 파일은 원본 이름·MIME 그대로', () => {
    expect(driveDeliveredName(file({ name: '견적서.docx', mimeType: DOCX }))).toBe('견적서.docx');
    expect(driveDeliveredMime(file({ mimeType: DOCX }))).toBe(DOCX);
  });

  it('Blob을 이름·MIME을 가진 File로 바꾼다', async () => {
    const result = driveBlobToFile(new Blob(['abc']), file({ name: '시트', mimeType: 'application/vnd.google-apps.spreadsheet' }));
    expect(result).toBeInstanceOf(File);
    expect([result.name, result.type, result.size]).toEqual(['시트.pdf', 'application/pdf', 3]);
  });
});

describe('표시', () => {
  it('내용 주소: 파일 id는 인코딩하고, 내려받기는 download=1', () => {
    expect(driveContentPath('abc')).toBe('/integrations/google-drive/files/abc/content');
    expect(driveContentPath('a/b', { download: true })).toBe('/integrations/google-drive/files/a%2Fb/content?download=1');
  });

  it('종류 이름과 탭 순서', () => {
    expect(DRIVE_KIND_TAB_ORDER.map((kind) => DRIVE_KIND_LABEL[kind])).toEqual(['전체', '사진', '녹음', '문서']);
    expect(driveKindLabel(file())).toBe('PDF');
    expect(driveKindLabel(file({ mimeType: 'application/vnd.google-apps.presentation' }))).toBe('Google 프레젠테이션');
    expect(driveKindLabel(file({ mimeType: DOCX }))).toBe('Word');
    expect(driveKindLabel(file({ kind: 'image', mimeType: 'image/png' }))).toBe('사진');
  });

  it('크기: Google 문서류는 크기를 주지 않아 "-"', () => {
    expect(driveSizeText(file({ size: 2048 }))).toBe('2.0 KB');
    expect(driveSizeText(file({ size: null, mimeType: 'application/vnd.google-apps.document' }))).toBe('-');
    expect(driveSizeText(file({ size: null }))).toBe('크기 모름');
  });
});

describe('driveAiImageProblem', () => {
  it('로컬 사진과 같이 PNG·JPEG·WebP만 붙인다', () => {
    for (const mimeType of ['image/png', 'image/jpeg', 'IMAGE/WEBP']) {
      expect(driveAiImageProblem({ mimeType })).toBeNull();
    }
    for (const mimeType of ['image/gif', 'image/heic', 'image/bmp', 'image/tiff']) {
      expect(driveAiImageProblem({ mimeType })).toBe('PNG, JPEG, WebP 사진만 붙일 수 있어요');
    }
  });
});
