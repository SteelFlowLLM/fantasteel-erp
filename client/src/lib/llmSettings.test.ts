import { describe, expect, it } from 'vitest';
import type { LlmConnectionView, LlmModelView } from '@fantasteel/shared';
import { llmModelOptions, showsSupportChoices, supportChoiceOf, supportValueOf, unslothModelWarning } from './llmSettings';

const model = (id: string, extra: Partial<LlmModelView> = {}): LlmModelView => ({ id, ownedBy: null, type: null, loaded: null, reasoning: null, ...extra });

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
    const none = { visionSupport: null, reasoningSupport: null };
    expect(showsSupportChoices(connection({}), none)).toBe(true);
    expect(showsSupportChoices(connection({ serverKind: 'openai' }), none)).toBe(true);
    expect(showsSupportChoices(connection({ serverKind: 'lmstudio' }), { visionSupport: true, reasoningSupport: null })).toBe(false);
    expect(showsSupportChoices(undefined, none)).toBe(false);
    expect(showsSupportChoices(undefined, { visionSupport: null, reasoningSupport: false })).toBe(true);
  });
});
