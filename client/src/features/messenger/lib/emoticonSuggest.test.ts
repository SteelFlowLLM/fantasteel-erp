import { MESSAGE_EMOTICON_KEYWORDS, MESSAGE_EMOTICONS, isMessageEmoticonKey } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { EMOTICON_SUGGEST_MAX, EMOTICON_SUGGEST_TEXT_MAX, suggestEmoticons } from '@/features/messenger/lib/emoticonSuggest';

describe('글자로 추천 낱말 (23번)', () => {
  it('낱말 목록의 키는 모두 있는 이모티콘이고 낱말은 비어 있지 않다', () => {
    for (const [key, words] of Object.entries(MESSAGE_EMOTICON_KEYWORDS)) {
      expect(isMessageEmoticonKey(key)).toBe(true);
      expect(words?.length ?? 0).toBeGreaterThan(0);
      for (const word of words ?? []) expect(word.trim()).not.toBe('');
    }
  });

  it('낱말을 그대로 적으면 그 이모티콘이 추천에 나온다', () => {
    for (const { key } of MESSAGE_EMOTICONS) {
      for (const word of MESSAGE_EMOTICON_KEYWORDS[key] ?? []) expect(suggestEmoticons(word, MESSAGE_EMOTICONS.length)).toContain(key);
    }
  });
});

describe('글자로 추천 (23번)', () => {
  it('글 전체와 같은 낱말이 먼저, 그다음 시작하는 낱말, 그다음 들어 있는 낱말', () => {
    expect(suggestEmoticons('넵')[0]).toBe('steelman-yes');
    expect(suggestEmoticons('네?')[0]).toBe('steelman-huh');
    expect(suggestEmoticons('네 알겠습니다')).toEqual(expect.arrayContaining(['steelman-yes', 'steelman-ok']));
    expect(suggestEmoticons('정말 감사합니다')).toContain('steelman-thanks');
    expect(suggestEmoticons('ㅋㅋㅋㅋ')[0]).toBe('steelman-lol');
  });

  it('대소문자·띄어쓰기·마침표는 무시한다', () => {
    expect(suggestEmoticons('  OK!! ')).toContain('steelman-ok');
    expect(suggestEmoticons('좋은아침')).toContain('steelman-morning');
    expect(suggestEmoticons('감사합니다...')).toContain('steelman-thanks');
  });

  it('한 글자 낱말은 글 가운데에서는 맞지 않는다', () => {
    expect(suggestEmoticons('그렇네')).not.toContain('steelman-yes');
    expect(suggestEmoticons('네')).toContain('steelman-yes');
  });

  it(`${EMOTICON_SUGGEST_MAX}개까지, 빈 글·긴 글·맞는 낱말이 없으면 빈 목록`, () => {
    expect(suggestEmoticons('확인 감사 수고 화이팅 대박 ㅋㅋ 사랑 최고').length).toBe(EMOTICON_SUGGEST_MAX);
    expect(suggestEmoticons('   ')).toEqual([]);
    expect(suggestEmoticons(`감사${'가'.repeat(EMOTICON_SUGGEST_TEXT_MAX)}`)).toEqual([]);
    expect(suggestEmoticons('SO-2610-001 재고 조회')).toEqual([]);
  });

  it('작은 이모티콘 글(:키:)은 빼고 본다', () => {
    expect(suggestEmoticons(':steelman-ok:')).toEqual([]);
    expect(suggestEmoticons(':steelman-ok: 감사')).toEqual(['steelman-thanks']);
  });

  it('낱말 목록을 바꿔 시험할 수 있다 (없는 이모티콘은 추천하지 않음)', () => {
    expect(suggestEmoticons('철강', EMOTICON_SUGGEST_MAX, { 'steelman-wall': ['철강'] })).toEqual(['steelman-wall']);
    expect(suggestEmoticons('넵', EMOTICON_SUGGEST_MAX, {})).toEqual([]);
  });
});
