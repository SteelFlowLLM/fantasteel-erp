// 철강맨AI 패널에서 보던 저장한 대화 (이슈 #399). 새로고침해도 그 대화를 다시 열려고 이 탭(sessionStorage)에 사원과 대화 id만 둔다.
// 대화 내용은 서버에 있다. 다른 사원으로 들어오면 쓰지 않는다.

export const AI_CHAT_THREAD_KEY = 'fantasteel.ai-chat.thread';

/** 저장된 글에서 이 사원의 대화 id를 읽는다. 다른 사원 것이거나 깨졌으면 null */
export function parseAiChatThread(raw: string | null, employeeId: number): number | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || !('employeeId' in value) || !('threadId' in value)) return null;
    const { threadId } = value;
    return value.employeeId === employeeId && typeof threadId === 'number' && Number.isInteger(threadId) && threadId > 0 ? threadId : null;
  } catch {
    return null;
  }
}

export function readAiChatThread(employeeId: number): number | null {
  try {
    return parseAiChatThread(window.sessionStorage.getItem(AI_CHAT_THREAD_KEY), employeeId);
  } catch {
    return null;
  }
}

/** threadId가 null이면 지운다 (새 대화) */
export function writeAiChatThread(employeeId: number, threadId: number | null): void {
  try {
    if (threadId === null) window.sessionStorage.removeItem(AI_CHAT_THREAD_KEY);
    else window.sessionStorage.setItem(AI_CHAT_THREAD_KEY, JSON.stringify({ employeeId, threadId }));
  } catch {
    // 저장할 수 없는 브라우저(사생활 보호 모드 등)면 새로고침 때 새 대화로 시작한다
  }
}
