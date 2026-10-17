import { DRIVE_IMAGE_MAX_BYTES, MEETING_AUDIO_MAX_BYTES, type DriveFileKind, type DriveFileView } from '@fantasteel/shared';
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

/**
 * files.list 검색어: 설정한 폴더 바로 아래, 휴지통 아닌 것, 종류별 MIME.
 * 녹음은 회의 음성 올리기와 같이 audio/*·video/webm(브라우저 녹음)·video/mp4를 받는다. 사진은 DRIVE_IMAGE_MIME_TYPES만.
 */
export function buildDriveListQuery(folderId: string, kind: DriveFileKind): string {
  const base = `${quote(folderId)} in parents and trashed = false`;
  const mime =
    kind === 'audio'
      ? "(mimeType contains 'audio/' or mimeType = 'video/webm' or mimeType = 'video/mp4')"
      : `(${DRIVE_IMAGE_MIME_TYPES.map((type) => `mimeType = '${type}'`).join(' or ')})`;
  return `${base} and ${mime}`;
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

/** 가져올 수 있는 종류인지. 녹음 판정은 회의 음성 올리기와 같다 */
export function driveFileKind(mimeType: string, name: string): DriveFileKind | null {
  const mime = normalizeMime(mimeType);
  if (isMeetingAudio(mime, name)) return 'audio';
  if (isDriveImage(mime)) return 'image';
  return null;
}

export function driveMaxBytes(kind: DriveFileKind): number {
  return kind === 'audio' ? MEETING_AUDIO_MAX_BYTES : DRIVE_IMAGE_MAX_BYTES;
}

/** Drive files 응답 한 개 (쓰는 칸만) */
export interface DriveFileMeta extends DriveFileView {
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
    name: r.name,
    mimeType: r.mimeType,
    size,
    modifiedTime: typeof r.modifiedTime === 'string' ? r.modifiedTime : null,
    thumbnailLink: typeof r.thumbnailLink === 'string' && r.thumbnailLink.startsWith('https://') ? r.thumbnailLink : null,
    parents: Array.isArray(r.parents) ? r.parents.filter((p): p is string => typeof p === 'string') : [],
    trashed: r.trashed === true,
  };
}

export function toDriveFileView(meta: DriveFileMeta): DriveFileView {
  return { id: meta.id, name: meta.name, mimeType: meta.mimeType, size: meta.size, modifiedTime: meta.modifiedTime, thumbnailLink: meta.thumbnailLink };
}

/** 응답 헤더 Content-Disposition. 한글 이름은 RFC 5987로, 따옴표 안 이름은 ASCII만 남긴다 */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file';
  let encoded: string;
  try {
    encoded = encodeURIComponent(fileName);
  } catch {
    // 짝 없는 대리 문자(깨진 이름)는 인코딩할 수 없다: ASCII 이름만 보낸다
    return `inline; filename="${ascii}"`;
  }
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
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
