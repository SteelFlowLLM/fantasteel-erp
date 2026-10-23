import { AI_IMAGE_MAX_BYTES, AI_IMAGE_MEDIA_TYPES, DRIVE_DOCUMENT_MAX_BYTES, DRIVE_EXPORT_MAX_BYTES, DRIVE_IMAGE_MAX_BYTES, MEETING_AUDIO_MAX_BYTES, type DriveFileKind, type DriveFileListKind, type DriveFileView } from '@fantasteel/shared';
import { isMeetingAudio } from '../../meeting-minutes/meeting-audio';

/** Drive 폴더·파일 id 모양. 공유 드라이브 최상위는 19자, 보통 파일은 28~44자 */
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;

export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
/** 목록 한 쪽 크기 */
export const DRIVE_PAGE_SIZE = 50;
/** 연결 확인에서 녹음·사진 수를 셀 때 앞에서부터 보는 파일 수 (Drive files.list 한 번의 최대) */
export const DRIVE_COUNT_PAGE_SIZE = 1000;

/** 목록·메타데이터에서 받는 칸 */
export const DRIVE_FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,thumbnailLink,parents,trashed';

export function isDriveId(value: string): boolean {
  return DRIVE_ID_PATTERN.test(value);
}

/**
 * 관리자가 붙여 넣은 Drive 폴더 주소나 id에서 폴더 id를 읽는다. 못 읽으면 null.
 *   1AbC…                                                    (id 그대로)
 *   https://drive.google.com/drive/folders/1AbC…?usp=sharing
 *   https://drive.google.com/drive/u/0/folders/1AbC…
 *   https://drive.google.com/open?id=1AbC… · folderview?id=… · embeddedfolderview?id=…
 * 파일 주소(/file/d/…)·내 드라이브(my-drive)·다른 호스트는 거절한다.
 */
export function normalizeDriveFolderId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (isDriveId(value)) return value;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname.toLowerCase() !== 'drive.google.com') return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const folderIndex = segments.indexOf('folders');
  let id: string | null = null;
  if (folderIndex >= 0) {
    id = segments[folderIndex + 1] ?? null;
  } else if (['open', 'folderview', 'embeddedfolderview'].includes(segments[segments.length - 1] ?? '')) {
    id = url.searchParams.get('id');
  }
  return id && isDriveId(id) ? id : null;
}

/** Drive 검색어 글 값 안의 ' 와 \ 를 막는다 (id 모양을 확인하지만 한 번 더 막는다) */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * 받는 사진 형식 (허용 목록). SVG처럼 스크립트를 담을 수 있는 형식은 이 서버 주소로 열리면 위험해서 목록에 없는 것은 모두 뺀다.
 * HEIC·HEIF는 아이폰 사진이다 (브라우저가 못 그리면 화면이 내려받기로 보인다).
 */
export const DRIVE_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/bmp', 'image/tiff'] as const;

/** 그대로 내려받는 문서. PDF는 브라우저에서 미리보고, Office 파일은 내려받기만 된다 */
export const DRIVE_PDF_MIME = 'application/pdf';
export const DRIVE_OFFICE_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

/** 글 파일 (철강맨AI가 읽는다, 이슈 #398). HTML처럼 이 서버 주소로 열면 스크립트가 도는 형식은 넣지 않는다 */
export const DRIVE_TEXT_MIME_TYPES = ['text/plain', 'text/markdown', 'text/x-markdown', 'text/csv'] as const;

/** Google 문서·스프레드시트·프레젠테이션: 내용이 없는 파일이라 files.export로 PDF를 만들어 준다 */
export const DRIVE_GOOGLE_DOC_MIME_TYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
] as const;

const AUDIO_QUERY = "(mimeType contains 'audio/' or mimeType = 'video/webm' or mimeType = 'video/mp4')";

function mimeEquals(types: readonly string[]): string {
  return types.map((type) => `mimeType = '${type}'`).join(' or ');
}

/**
 * files.list 검색어: 설정한 폴더 바로 아래, 휴지통 아닌 것, 종류별 MIME.
 * 녹음은 회의 음성 올리기와 같이 audio/*·video/webm(브라우저 녹음)·video/mp4를 받는다. 사진은 DRIVE_IMAGE_MIME_TYPES만.
 * 문서는 PDF·Office·Google 문서 세 가지. all은 위 셋을 모두.
 */
export function buildDriveListQuery(folderId: string, kind: DriveFileListKind): string {
  const base = `${quote(folderId)} in parents and trashed = false`;
  const audio = AUDIO_QUERY;
  const image = `(${mimeEquals(DRIVE_IMAGE_MIME_TYPES)})`;
  const document = `(${mimeEquals([DRIVE_PDF_MIME, ...DRIVE_OFFICE_MIME_TYPES, ...DRIVE_GOOGLE_DOC_MIME_TYPES, ...DRIVE_TEXT_MIME_TYPES])})`;
  const mime = kind === 'audio' ? audio : kind === 'image' ? image : kind === 'document' ? document : `(${audio} or ${image} or ${document})`;
  return `${base} and ${mime}`;
}

/** drive_search 검색어를 나누는 낱말 수·한 낱말 길이 상한 (가정값, 이슈 #473) */
export const DRIVE_SEARCH_TERMS_MAX = 6;
export const DRIVE_SEARCH_TERM_MAX = 40;

/**
 * 검색어를 낱말로 나눈다 (공백·쉼표·세미콜론 기준). Drive의 name contains·fullText contains는 낱말 단위로 맞춰서
 * 문장 통째로 넣으면 이름에 그 문장 전체가 든 파일만 찾는다. 같은 낱말(대소문자 무시)은 한 번만, 6개·한 낱말 40자까지.
 */
export function driveSearchTerms(query: string | null): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of (query ?? '').split(/[\s,;]+/)) {
    const term = raw.trim().slice(0, DRIVE_SEARCH_TERM_MAX);
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    terms.push(term);
    if (terms.length >= DRIVE_SEARCH_TERMS_MAX) break;
  }
  return terms;
}

/** all: 낱말이 모두 든 파일, any: 하나라도 든 파일 */
export type DriveSearchMatch = 'all' | 'any';

/**
 * 철강맨AI drive_search의 files.list 검색어 (이슈 #398, 내용 검색 #473). 목록과 같은 폴더·휴지통·종류 조건에 낱말 조건을 더한다.
 * 낱말마다 `name contains`(이름, 낱말 앞부분)와 `fullText contains`(이름·설명·내용: Google 문서·스프레드시트·PDF·Office·글 파일)를 or로 묶고,
 * 낱말끼리는 match에 따라 and/or로 잇는다. content를 false로 하면 이름만 본다(이름으로 파일을 집을 때).
 */
export function buildDriveSearchQuery(folderId: string, kind: DriveFileListKind, query: string | null, match: DriveSearchMatch = 'all', content = true): string {
  const base = buildDriveListQuery(folderId, kind);
  const terms = driveSearchTerms(query);
  if (terms.length === 0) return base;
  const conditions = terms.map((term) => (content ? `(name contains ${quote(term)} or fullText contains ${quote(term)})` : `name contains ${quote(term)}`));
  return `${base} and (${conditions.join(match === 'all' ? ' and ' : ' or ')})`;
}

/** 연결 확인에서 폴더의 파일 종류를 셀 때 */
export function buildDriveFolderQuery(folderId: string): string {
  return `${quote(folderId)} in parents and trashed = false`;
}

/** MIME은 대소문자를 가리지 않는다 (IMAGE/SVG+XML도 SVG). 매개변수(;charset=…)는 뗀다 */
function normalizeMime(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
}

export function isDriveImage(mimeType: string): boolean {
  return (DRIVE_IMAGE_MIME_TYPES as readonly string[]).includes(normalizeMime(mimeType));
}

/** Google 문서류인지 (PDF로 내보내야 열린다) */
export function isDriveGoogleDoc(mimeType: string): boolean {
  return (DRIVE_GOOGLE_DOC_MIME_TYPES as readonly string[]).includes(normalizeMime(mimeType));
}

/** 가져올 수 있는 종류인지. 녹음 판정은 회의 음성 올리기와 같다 */
export function driveFileKind(mimeType: string, name: string): DriveFileKind | null {
  const mime = normalizeMime(mimeType);
  if (isMeetingAudio(mime, name)) return 'audio';
  if (isDriveImage(mime)) return 'image';
  if (mime === DRIVE_PDF_MIME || isDriveGoogleDoc(mime) || (DRIVE_OFFICE_MIME_TYPES as readonly string[]).includes(mime) || (DRIVE_TEXT_MIME_TYPES as readonly string[]).includes(mime)) return 'document';
  return null;
}

/** 철강맨AI가 읽을 때의 크기 상한 (가정값). 화면에서 여는 상한보다 작다: 글만 뽑으면 되고, 받은 내용을 메모리에 올린다 */
export const DRIVE_AI_PDF_MAX_BYTES = 20 * 1024 * 1024;
export const DRIVE_AI_EXPORT_MAX_BYTES = 5 * 1024 * 1024;
export const DRIVE_AI_TEXT_MAX_BYTES = 2 * 1024 * 1024;

/** Google 문서류를 글로 내보낼 형식: 문서·프레젠테이션은 글, 스프레드시트는 CSV(첫 시트) */
const DRIVE_TEXT_EXPORT: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

/** 철강맨AI가 파일을 읽는 방법. 받지 않는 것은 이유를 모델에 돌려준다 */
export type DriveReadPlan =
  | { mode: 'pdf'; maxBytes: number }
  | { mode: 'text'; maxBytes: number; exportMimeType: string | null }
  | { mode: 'image'; maxBytes: number; mediaType: (typeof AI_IMAGE_MEDIA_TYPES)[number] }
  | { mode: 'unsupported'; reason: string };

export function driveReadPlan(mimeType: string, kind: DriveFileKind): DriveReadPlan {
  const mime = normalizeMime(mimeType);
  if (kind === 'audio') return { mode: 'unsupported', reason: '녹음(오디오) 파일이라 글로 읽을 수 없어요. 회의록 화면에서 전사할 수 있어요' };
  if (kind === 'image') {
    const mediaType = (AI_IMAGE_MEDIA_TYPES as readonly string[]).includes(mime) ? (mime as (typeof AI_IMAGE_MEDIA_TYPES)[number]) : null;
    if (!mediaType) return { mode: 'unsupported', reason: 'PNG·JPEG·WebP 사진만 볼 수 있어요' };
    return { mode: 'image', maxBytes: AI_IMAGE_MAX_BYTES, mediaType };
  }
  if (mime === DRIVE_PDF_MIME) return { mode: 'pdf', maxBytes: DRIVE_AI_PDF_MAX_BYTES };
  const exportMimeType = DRIVE_TEXT_EXPORT[mime];
  if (exportMimeType) return { mode: 'text', maxBytes: DRIVE_AI_EXPORT_MAX_BYTES, exportMimeType };
  if ((DRIVE_TEXT_MIME_TYPES as readonly string[]).includes(mime)) return { mode: 'text', maxBytes: DRIVE_AI_TEXT_MAX_BYTES, exportMimeType: null };
  return { mode: 'unsupported', reason: 'Word·Excel·PowerPoint 파일은 아직 읽지 못해요. Google 문서로 바꾸거나 PDF로 올려 달라고 안내해요' };
}

/** 종류별 크기 상한. Google 문서는 내보내기 상한(10MB)이다: 원본 크기를 알 수 없고 Drive가 그 이상은 내보내지 않는다 */
export function driveMaxBytes(kind: DriveFileKind, mimeType = ''): number {
  if (kind === 'audio') return MEETING_AUDIO_MAX_BYTES;
  if (kind === 'image') return DRIVE_IMAGE_MAX_BYTES;
  return isDriveGoogleDoc(mimeType) ? DRIVE_EXPORT_MAX_BYTES : DRIVE_DOCUMENT_MAX_BYTES;
}

/** 브라우저가 열지 못해 내려받기만 되는 파일 (Office). 열어 보라고 inline으로 내보내도 어차피 내려받기가 된다 */
export function isDriveDownloadOnly(mimeType: string): boolean {
  return (DRIVE_OFFICE_MIME_TYPES as readonly string[]).includes(normalizeMime(mimeType));
}

/** 응답으로 보낼 MIME과 이름. Google 문서는 PDF로 내보내므로 application/pdf, 이름 끝에 .pdf */
export function driveDelivery(meta: Pick<DriveFileMeta, 'mimeType' | 'name'>): { mimeType: string; name: string } {
  if (!isDriveGoogleDoc(meta.mimeType)) return { mimeType: meta.mimeType, name: meta.name };
  return { mimeType: DRIVE_PDF_MIME, name: /\.pdf$/i.test(meta.name) ? meta.name : `${meta.name}.pdf` };
}

/** Drive files 응답 한 개 (쓰는 칸만) */
export interface DriveFileMeta extends Omit<DriveFileView, 'kind'> {
  parents: string[];
  trashed: boolean;
}

/** Drive files 응답 한 개를 읽는다. id·이름·MIME이 없으면 null */
export function readDriveFile(raw: unknown): DriveFileMeta | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.mimeType !== 'string') return null;
  // Drive는 int64 크기를 문자열로 준다
  const size = typeof r.size === 'string' && /^\d+$/.test(r.size) ? Number(r.size) : typeof r.size === 'number' ? r.size : null;
  return {
    id: r.id,
    // macOS에서 올린 파일은 한글 이름이 자모로 풀린(NFD) 채 온다. 화면 검색어(NFC)와 맞고 AI가 옮겨 적다 글자가 깨지지 않게 합쳐서 쓴다
    name: r.name.normalize('NFC'),
    mimeType: r.mimeType,
    size,
    modifiedTime: typeof r.modifiedTime === 'string' ? r.modifiedTime : null,
    thumbnailLink: typeof r.thumbnailLink === 'string' && r.thumbnailLink.startsWith('https://') ? r.thumbnailLink : null,
    parents: Array.isArray(r.parents) ? r.parents.filter((p): p is string => typeof p === 'string') : [],
    trashed: r.trashed === true,
  };
}

/** 종류를 정한 뒤의 화면용 모양 */
export function toDriveFileView(meta: DriveFileMeta, kind: DriveFileKind): DriveFileView {
  return { id: meta.id, name: meta.name, mimeType: meta.mimeType, kind, size: meta.size, modifiedTime: meta.modifiedTime, thumbnailLink: meta.thumbnailLink };
}

/** 응답 헤더 Content-Disposition. 한글 이름은 RFC 5987로, 따옴표 안 이름은 ASCII만 남긴다. attachment면 브라우저가 열지 않고 저장한다 */
export function contentDisposition(fileName: string, disposition: 'inline' | 'attachment' = 'inline'): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file';
  let encoded: string;
  try {
    encoded = encodeURIComponent(fileName);
  } catch {
    // 짝 없는 대리 문자(깨진 이름)는 인코딩할 수 없다: ASCII 이름만 보낸다
    return `${disposition}; filename="${ascii}"`;
  }
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * 브라우저가 보낸 Range 머리를 Drive로 넘길지 정한다. 한 구간 `bytes=a-b`·`bytes=a-`·`bytes=-n`만 받는다 (여러 구간·다른 단위는 무시하고 전체를 준다).
 * 파일 크기를 알면 시작이 크기 이상인 범위를 'unsatisfiable'로 알린다 (416).
 */
export function parseRangeHeader(header: string | undefined, size: number | null): { range: string } | 'unsatisfiable' | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (match[1] === '' && match[2] === '')) return null;
  const start = match[1] === '' ? null : Number(match[1]);
  const end = match[2] === '' ? null : Number(match[2]);
  if ((start !== null && !Number.isSafeInteger(start)) || (end !== null && !Number.isSafeInteger(end))) return null;
  if (start !== null && end !== null && end < start) return null;
  if (start === null && end === 0) return 'unsatisfiable';
  if (size !== null && start !== null && start >= size) return 'unsatisfiable';
  return { range: `bytes=${match[1]}-${match[2]}` };
}
