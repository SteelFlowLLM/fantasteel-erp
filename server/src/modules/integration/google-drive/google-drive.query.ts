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
 * files.list 검색어: 설정한 폴더 바로 아래, 휴지통 아닌 것, 종류별 MIME.
 * 녹음은 회의 음성 올리기와 같이 audio/*·video/webm(브라우저 녹음)·video/mp4를 받는다.
 * 사진은 image/*에서 SVG를 뺀다 (이 서버 주소로 SVG를 열면 스크립트가 돌 수 있다).
 */
export function buildDriveListQuery(folderId: string, kind: DriveFileKind): string {
  const base = `${quote(folderId)} in parents and trashed = false`;
  const mime =
    kind === 'audio'
      ? "(mimeType contains 'audio/' or mimeType = 'video/webm' or mimeType = 'video/mp4')"
      : "(mimeType contains 'image/' and mimeType != 'image/svg+xml')";
  return `${base} and ${mime}`;
}

/** 연결 확인에서 폴더의 파일 종류를 셀 때 */
export function buildDriveFolderQuery(folderId: string): string {
  return `${quote(folderId)} in parents and trashed = false`;
}

export function isDriveImage(mimeType: string): boolean {
  return mimeType.startsWith('image/') && mimeType !== 'image/svg+xml';
}

/** 가져올 수 있는 종류인지. 녹음 판정은 회의 음성 올리기와 같다 */
export function driveFileKind(mimeType: string, name: string): DriveFileKind | null {
  if (isMeetingAudio(mimeType, name)) return 'audio';
  if (isDriveImage(mimeType)) return 'image';
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
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
