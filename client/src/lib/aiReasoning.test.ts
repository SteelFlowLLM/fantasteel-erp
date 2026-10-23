// 생각 정도 선택: 저장값 읽기와 '이번 질문만'이 켜졌을 때 보낸 뒤 기본값으로 돌아가는 규칙.
import { AI_REASONING_DEFAULT } from '@fantasteel/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_REASONING_KEY, DEFAULT_AI_REASONING_PREFERENCE, parseAiReasoningPreference, readAiReasoningPreference, reasoningAfterSend, writeAiReasoningPreference } from '@/lib/aiReasoning';

afterEach(() => vi.unstubAllGlobals());

describe('reasoningAfterSend', () => {
  it('이번 질문만이 켜져 있으면 보낸 뒤 기본값으로 돌아간다', () => {
    expect(reasoningAfterSend('high', true)).toBe(AI_REASONING_DEFAULT);
    expect(reasoningAfterSend('off', true)).toBe(AI_REASONING_DEFAULT);
  });

  it('꺼져 있으면 고른 값을 그대로 둔다', () => {
    expect(reasoningAfterSend('high', false)).toBe('high');
  });
});

describe('저장된 설정', () => {
  it('깨졌거나 없는 값은 기본값(보통, 이번 질문만 켬)으로 읽는다', () => {
    expect(parseAiReasoningPreference(null)).toEqual(DEFAULT_AI_REASONING_PREFERENCE);
    expect(parseAiReasoningPreference('not json')).toEqual(DEFAULT_AI_REASONING_PREFERENCE);
    expect(parseAiReasoningPreference('{"level":"extreme","oneShot":"yes"}')).toEqual(DEFAULT_AI_REASONING_PREFERENCE);
    expect(parseAiReasoningPreference('{"level":"low","oneShot":false}')).toEqual({ level: 'low', oneShot: false });
  });

  it('localStorage를 못 쓰는 환경에서도 읽기·쓰기가 오류 없이 기본값으로 동작한다', () => {
    // node 환경에는 window가 없어 접근하면 ReferenceError
    expect(readAiReasoningPreference()).toEqual(DEFAULT_AI_REASONING_PREFERENCE);
    expect(() => writeAiReasoningPreference({ level: 'high', oneShot: false })).not.toThrow();
  });

  it('쓴 값을 다시 읽는다', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } });
    writeAiReasoningPreference({ level: 'high', oneShot: false });
    expect(data.has(AI_REASONING_KEY)).toBe(true);
    expect(readAiReasoningPreference()).toEqual({ level: 'high', oneShot: false });
  });
});
