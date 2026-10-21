import { describe, expect, it } from 'vitest';
import type { LlmConnectionView, LlmModelView } from '@fantasteel/shared';
import { contextLengthValueOf, contextLengthWarning, llmModelOptions, showsSupportChoices, supportChoiceOf, supportValueOf, unslothModelWarning } from './llmSettings';

const model = (id: string, extra: Partial<LlmModelView> = {}): LlmModelView => ({ id, ownedBy: null, type: null, loaded: null, reasoning: null, contextLength: null, ...extra });

function connection(extra: Partial<LlmConnectionView>): LlmConnectionView {
  return { connected: true, baseUrl: 'http://127.0.0.1:8888/v1', latencyMs: 5, models: [], error: null, serverKind: 'unsloth', autoSwitch: false, ...extra };
}

describe('llmModelOptions', () => {
  it('Unsloth면 불러옴·안 불러옴을 표시하고 불러온 모델을 앞에 둔다', () => {
    const result = connection({ models: [model('a', { loaded: false }), model('b', { loaded: true, reasoning: true })] });
    expect(llmModelOptions(result, '')).toEqual([
      { id: 'b', label: 'b · 생각 가능 · 불러옴' },
      { id: 'a', label: 'a · 안 불러옴' },
    ]);
  });

  it('LM Studio는 로드됨만 표시하고 임베딩 모델은 뺀다', () => {
    const result = connection({ serverKind: 'lmstudio', autoSwitch: null, models: [model('e', { type: 'embeddings' }), model('a', { loaded: false }), model('b', { loaded: true })] });
    expect(llmModelOptions(result, '')).toEqual([
      { id: 'b', label: 'b · 로드됨' },
      { id: 'a', label: 'a' },
    ]);
  });

  it('고른 모델이 목록에 없으면 따로 보인다', () => {
    expect(llmModelOptions(connection({}), 'x')).toEqual([{ id: 'x', label: 'x (지금 목록에 없음)' }]);
  });
});

describe('unslothModelWarning', () => {
  it('고른 모델이 안 불러와져 있으면 불러온 모델과 함께 안내한다', () => {
    const result = connection({ models: [model('a', { loaded: false }), model('b', { loaded: true })] });
    expect(unslothModelWarning(result, 'a')).toBe(
      '고른 모델이 Unsloth Studio에 불러와 있지 않아요 (지금 불러온 모델: b). Unsloth Studio에서 모델을 불러오거나 Settings > API > Model auto-switch를 켜 주세요',
    );
    expect(unslothModelWarning(connection({ models: [model('a', { loaded: false })] }), 'a')).toContain('지금 불러온 모델이 없어요');
  });

  it('불러와 있거나 auto-switch가 켜져 있거나 Unsloth가 아니면 안내하지 않는다', () => {
    const models = [model('a', { loaded: false }), model('b', { loaded: true })];
    expect(unslothModelWarning(connection({ models }), 'b')).toBeNull();
    expect(unslothModelWarning(connection({ models, autoSwitch: true }), 'a')).toBeNull();
    expect(unslothModelWarning(connection({ models, serverKind: 'lmstudio' }), 'a')).toBeNull();
    expect(unslothModelWarning(connection({ models }), '')).toBeNull();
    expect(unslothModelWarning(undefined, 'a')).toBeNull();
  });
});

describe('지원 여부 고르기', () => {
  it('null·true·false를 오간다', () => {
    for (const value of [null, true, false]) expect(supportValueOf(supportChoiceOf(value))).toBe(value);
  });

  it('LM Studio가 아닐 때만 보이고, 연결 확인 전에는 저장한 값이 있을 때만 보인다', () => {
    const none = { visionSupport: null, reasoningSupport: null, contextLength: null };
    expect(showsSupportChoices(connection({}), none)).toBe(true);
    expect(showsSupportChoices(connection({ serverKind: 'openai' }), none)).toBe(true);
    expect(showsSupportChoices(connection({ serverKind: 'lmstudio' }), { ...none, visionSupport: true })).toBe(false);
    expect(showsSupportChoices(undefined, none)).toBe(false);
    expect(showsSupportChoices(undefined, { ...none, reasoningSupport: false })).toBe(true);
    expect(showsSupportChoices(undefined, { ...none, contextLength: 8192 })).toBe(true);
  });
});

describe('문맥 길이', () => {
  it('모델이 알린 문맥 길이가 16,384토큰보다 작으면 서버에 맞는 방법으로 경고한다', () => {
    const result = connection({ models: [model('a', { loaded: true, contextLength: 8192 })] });
    expect(contextLengthWarning(result, 'a', null)).toBe(
      '문맥 길이가 8,192토큰이라 철강맨AI의 지시·도구 설명(약 16,384토큰)이 다 들어가지 않을 수 있어요. Unsloth Studio에서 Context Length를 늘려 주세요',
    );
    expect(contextLengthWarning({ ...result, serverKind: 'lmstudio' }, 'a', null)).toContain('LM Studio에서 모델을 불러올 때');
    expect(contextLengthWarning(connection({ models: [model('a', { contextLength: 32768 })] }), 'a', 4096)).toBeNull();
  });

  it('모델 정보가 없으면 관리자가 넣은 값으로 보고(LM Studio 제외), 둘 다 없으면 경고하지 않는다', () => {
    const result = connection({ serverKind: 'openai', models: [model('a')] });
    expect(contextLengthWarning(result, 'a', 4096)).toContain('더 긴 문맥을 받는 모델');
    expect(contextLengthWarning(result, 'a', null)).toBeNull();
    expect(contextLengthWarning({ ...result, serverKind: 'lmstudio' }, 'a', 4096)).toBeNull();
  });

  it('입력칸 글을 값으로 바꾼다', () => {
    expect(contextLengthValueOf('')).toBeNull();
    expect(contextLengthValueOf('32,768')).toBe(32768);
    expect(contextLengthValueOf('abc')).toBeUndefined();
    expect(contextLengthValueOf('100')).toBeUndefined();
  });
});
