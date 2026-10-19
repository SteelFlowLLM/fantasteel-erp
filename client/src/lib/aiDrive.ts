// 철강맨AI Drive (이슈 #398 2단계, 문서에 없는 기능)의 화면 도우미: 켜기 설정 저장, 못 켤 때 이유, 도구 줄 요약, 입력칸 @ 파일 고르기.
// 켜기는 사원별이 아니라 이 브라우저에 저장한다 (계정에 저장할 컬럼이 ERD에 없다).
import { AI_DRIVE_ATTACH_MAX, type AiNotionCapabilities, type AiWebSource, type DriveFileView } from '@fantasteel/shared';

export const AI_DRIVE_KEY = 'fantasteel.ai-drive';

export const AI_DRIVE_TITLE = '켜면 철강맨AI가 회사 Drive 폴더에서 파일을 찾아 읽어요 (PDF·Google 문서·글 파일·사진). 입력칸에 @를 치면 파일을 직접 붙일 수 있어요.';
export const AI_DRIVE_OFF_REASON = 'Drive를 쓸 수 없어요';
export const AI_DRIVE_UNAVAILABLE_HINT = 'AI 연결을 확인하지 못해 지금은 켤 수 없어요';
/** @ 고르기 창에 보이는 파일 수 */
export const DRIVE_MENTION_LIST_MAX = 20;

export function parseAiDrivePreference(raw: string | null): boolean {
  return raw === 'true';
}

export function readAiDrivePreference(): boolean {
  try {
    return parseAiDrivePreference(window.localStorage.getItem(AI_DRIVE_KEY));
  } catch {
    return false;
  }
}

export function writeAiDrivePreference(on: boolean): void {
  try {
    window.localStorage.setItem(AI_DRIVE_KEY, String(on));
  } catch {
    // localStorage를 쓸 수 없는 환경이면 이 화면을 열어 둔 동안만 유지한다
  }
}

/** Drive 칩을 켤 수 없는 이유. 켤 수 있으면 null. 서버가 연결·폴더를 확인해 줘야 쓸 수 있어 모르면 막는다 */
export function driveDisabledReason(capabilities: { drive?: AiNotionCapabilities } | undefined, isError: boolean): string | null {
  if (isError) return AI_DRIVE_UNAVAILABLE_HINT;
  const drive = capabilities?.drive;
  if (!drive) return AI_DRIVE_OFF_REASON;
  if (drive.available) return null;
  return drive.reason?.trim() || AI_DRIVE_OFF_REASON;
}

export function driveToolRunningText(name: string): string | null {
  if (name === 'drive_search') return ' … 찾는 중';
  if (name === 'drive_read_file') return ' … 읽는 중';
  return null;
}

/** 끝난 Drive 도구 줄 요약: 찾기는 "결과 N개", 읽기는 "읽음" (파일 이름은 사원이 올린 글이라 이 줄에는 쓰지 않는다) */
export function driveToolDoneText(name: string, webSources: readonly AiWebSource[] | undefined): string | null {
  if (name === 'drive_search') {
    const count = webSources?.length ?? 0;
    return count > 0 ? `결과 ${count}개` : '결과 없음';
  }
  if (name === 'drive_read_file') return webSources?.length ? '읽음' : '읽지 못함';
  return null;
}

// ── 입력칸 @ ──

/**
 * 방금 친 글자가 파일 고르기를 여는 @인지. 바뀌기 전 글에 @ 한 글자만 커서 앞에 더해졌고, 그 앞이 처음이거나 띄어쓰기일 때만 연다
 * (메일 주소 a@b처럼 낱말 가운데의 @와 붙여 넣은 글은 열지 않는다). 열면 그 @의 위치, 아니면 null
 */
export function mentionTriggerAt(previous: string, next: string, caret: number): number | null {
  if (next.length !== previous.length + 1 || caret < 1 || next[caret - 1] !== '@') return null;
  if (next.slice(0, caret - 1) + next.slice(caret) !== previous) return null;
  const before = caret >= 2 ? next[caret - 2] : '';
  return before === '' || /\s/.test(before) ? caret - 1 : null;
}

/** 파일을 골랐으면 그 @를 글에서 뺀다 (파일은 글이 아니라 입력칸 위 칩으로 붙는다). 그 자리가 @가 아니면 그대로 */
export function removeMentionTrigger(value: string, index: number): string {
  return value[index] === '@' ? value.slice(0, index) + value.slice(index + 1) : value;
}

/** @ 창의 파일: 녹음은 읽지 못해 빼고, 이름에 검색어가 든 것(띄어쓰기·대소문자 무시)을 최신순 그대로 */
export function filterMentionFiles(files: readonly DriveFileView[], query: string): DriveFileView[] {
  const q = query.toLowerCase().replace(/\s+/g, '');
  return files.filter((f) => f.kind !== 'audio' && (!q || f.name.toLowerCase().replace(/\s+/g, '').includes(q))).slice(0, DRIVE_MENTION_LIST_MAX);
}

/** 위·아래 화살표로 고른 줄을 옮긴다 (끝에서 처음으로 돈다) */
export function moveMentionIndex(current: number, delta: 1 | -1, length: number): number {
  if (length === 0) return 0;
  return (current + delta + length) % length;
}

/** 문서를 질문에 붙인다. 같은 파일은 한 번만, AI_DRIVE_ATTACH_MAX개까지. 못 붙이면 이유 */
export function attachDriveFile(list: readonly DriveFileView[], file: DriveFileView): { list: DriveFileView[]; problem: string | null } {
  if (list.some((f) => f.id === file.id)) return { list: [...list], problem: null };
  if (list.length >= AI_DRIVE_ATTACH_MAX) return { list: [...list], problem: `Drive 파일은 ${AI_DRIVE_ATTACH_MAX}개까지 붙일 수 있어요` };
  return { list: [...list, file], problem: null };
}
