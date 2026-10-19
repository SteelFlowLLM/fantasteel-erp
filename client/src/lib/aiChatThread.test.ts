import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_CHAT_THREAD_KEY, parseAiChatThread, readAiChatThread, writeAiChatThread } from '@/lib/aiChatThread';

afterEach(() => vi.unstubAllGlobals());

describe('보던 대화 기억하기 (이슈 #399)', () => {
  it('이 사원의 대화 id만 읽고, 다른 사원 것이나 깨진 값은 null', () => {
    expect(parseAiChatThread(JSON.stringify({ employeeId: 3, threadId: 12 }), 3)).toBe(12);
    expect(parseAiChatThread(JSON.stringify({ employeeId: 4, threadId: 12 }), 3)).toBeNull();
    expect(parseAiChatThread(JSON.stringify({ employeeId: 3, threadId: '12' }), 3)).toBeNull();
    expect(parseAiChatThread(JSON.stringify({ employeeId: 3, threadId: 0 }), 3)).toBeNull();
    expect(parseAiChatThread('{깨짐', 3)).toBeNull();
    expect(parseAiChatThread(null, 3)).toBeNull();
  });

  it('쓰고 읽고, null이면 지운다', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', { sessionStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) } });
    writeAiChatThread(3, 12);
    expect(readAiChatThread(3)).toBe(12);
    writeAiChatThread(3, null);
    expect(data.has(AI_CHAT_THREAD_KEY)).toBe(false);
  });

  it('sessionStorage를 못 쓰는 환경에서도 오류 없이 새 대화로 둔다', () => {
    vi.stubGlobal('window', {});
    expect(readAiChatThread(3)).toBeNull();
    expect(() => writeAiChatThread(3, 12)).not.toThrow();
  });
});
