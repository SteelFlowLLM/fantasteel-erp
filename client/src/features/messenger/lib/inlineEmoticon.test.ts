import {
  MESSAGE_REACTION_EMOJIS,
  STEELMAN_REACTIONS,
  inlineEmoticonKeys,
  inlineEmoticonText,
  inlineEmoticonToken,
  isMessageEmoticonKey,
  reactionEmoticonKey,
  reactionLabel,
  splitInlineEmoticons,
} from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { splitMessageText } from '@/features/messenger/lib/messageText';

describe('글 속 작은 이모티콘 (23번)', () => {
  it('":키:"를 그림 조각으로 나누고, 모르는 키·콜론이 빠진 글은 글로 둔다', () => {
    expect(inlineEmoticonToken('steelman-ok')).toBe(':steelman-ok:');
    expect(splitInlineEmoticons('좋아요 :steelman-ok::steelman-lol: 끝 :steelman-none: steelman-ok:')).toEqual([
      { kind: 'text', text: '좋아요 ' },
      { kind: 'emoticon', key: 'steelman-ok', text: ':steelman-ok:' },
      { kind: 'emoticon', key: 'steelman-lol', text: ':steelman-lol:' },
      { kind: 'text', text: ' 끝 :steelman-none: steelman-ok:' },
    ]);
    expect(splitInlineEmoticons('')).toEqual([]);
    expect(splitInlineEmoticons(':steelman-ok:')).toEqual([{ kind: 'emoticon', key: 'steelman-ok', text: ':steelman-ok:' }]);
  });

  it('미리보기 글은 "(이름)"으로 바꾸고 모르는 키는 그대로 둔다', () => {
    expect(inlineEmoticonText(':steelman-ok: 확인했어요 :steelman-none:')).toBe('(확인) 확인했어요 :steelman-none:');
    expect(inlineEmoticonText('시간: 10:30')).toBe('시간: 10:30');
  });

  it('본문의 작은 이모티콘 키는 나온 순서로 한 번씩', () => {
    expect(inlineEmoticonKeys(':steelman-lol: :steelman-ok: :steelman-lol:')).toEqual(['steelman-lol', 'steelman-ok']);
  });

  it('말풍선 조각: 멘션·링크와 함께 작은 이모티콘 조각을 낸다', () => {
    expect(
      splitMessageText('@권예진 :steelman-ok: SO-2610-001', { mentionNames: ['권예진'], myNames: [], links: [{ text: 'SO-2610-001', href: '/sales-orders/1' }] }),
    ).toEqual([
      { kind: 'mention', text: '@권예진', isMe: false },
      { kind: 'text', text: ' ' },
      { kind: 'emoticon', text: ':steelman-ok:', key: 'steelman-ok' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'SO-2610-001', href: '/sales-orders/1' },
    ]);
  });
});

describe('작은 철강맨 반응 (23번)', () => {
  it('철강맨 반응 값은 반응 목록에 있고 16자 이하(message_reaction.emoji varchar(16)), 그림은 있는 이모티콘이다', () => {
    for (const { value, emoticonKey } of STEELMAN_REACTIONS) {
      expect(MESSAGE_REACTION_EMOJIS).toContain(value);
      expect(value.length).toBeLessThanOrEqual(16);
      expect(isMessageEmoticonKey(emoticonKey)).toBe(true);
    }
    expect(STEELMAN_REACTIONS.map((r) => r.value)).toEqual(['sm:ok', 'sm:thanks', 'sm:lol', 'sm:love']);
  });

  it('반응 값 → 그림 키·읽는 이름. 이모지는 그대로', () => {
    expect(reactionEmoticonKey('sm:thanks')).toBe('steelman-thanks');
    expect(reactionEmoticonKey('👍')).toBeNull();
    expect(reactionLabel('sm:ok')).toBe('철강맨 확인');
    expect(reactionLabel('👍')).toBe('👍');
  });
});
