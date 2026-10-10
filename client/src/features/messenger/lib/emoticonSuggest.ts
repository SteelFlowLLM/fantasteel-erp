// 글자로 추천 (23번, 문서에 없는 추가 기능): 입력창 글에 맞는 이모티콘을 입력창 위에 몇 개 보인다.
// 낱말은 shared MESSAGE_EMOTICON_KEYWORDS. 순수 함수라 화면 밖에서 시험한다.
import { MESSAGE_EMOTICONS, MESSAGE_EMOTICON_KEYWORDS, splitInlineEmoticons, type MessageEmoticonKey } from '@fantasteel/shared';

/** 한 번에 보이는 추천 수 (가정값) */
export const EMOTICON_SUGGEST_MAX = 6;
/** 이보다 긴 글에는 추천하지 않는다 (가정값). 긴 글을 쓰는 동안 추천 줄이 나타났다 사라지며 방해하지 않게 */
export const EMOTICON_SUGGEST_TEXT_MAX = 40;

type Keywords = Partial<Record<MessageEmoticonKey, readonly string[]>>;

/** 비교용: 소문자로, 띄어쓰기와 마침표·쉼표·느낌표·물결은 뺀다 ('?'는 '네'와 '네?'를 가르려고 남긴다) */
const normalize = (text: string): string => text.toLowerCase().replace(/[\s.,!~…·]/g, '');

/** 낱말 하나가 얼마나 맞는지: 0 = 글 전체와 같음, 1 = 글이 그 낱말로 시작, 2 = 글 안에 있음(두 글자 이상만), 맞지 않으면 null */
function scoreOf(text: string, keyword: string): number | null {
  if (!keyword) return null;
  if (text === keyword) return 0;
  if (text.startsWith(keyword)) return 1;
  if (keyword.length >= 2 && text.includes(keyword)) return 2;
  return null;
}

/** 글에 맞는 이모티콘: 잘 맞는 것부터, 같으면 고르기 창 순서. 글이 비었거나 길면 빈 목록 */
export function suggestEmoticons(text: string, limit = EMOTICON_SUGGEST_MAX, keywords: Keywords = MESSAGE_EMOTICON_KEYWORDS): MessageEmoticonKey[] {
  // 작은 이모티콘 글(':steelman-ok:')은 빼고 비교한다. 이미 넣은 이모티콘을 다시 추천하거나 'ok' 같은 낱말이 키 글자에 맞지 않게
  const trimmed = splitInlineEmoticons(text)
    .map((part) => (part.kind === 'text' ? part.text : ' '))
    .join('')
    .trim();
  if (!trimmed || trimmed.length > EMOTICON_SUGGEST_TEXT_MAX) return [];
  const target = normalize(trimmed);
  if (!target) return [];
  const scored: { key: MessageEmoticonKey; score: number; order: number }[] = [];
  MESSAGE_EMOTICONS.forEach(({ key }, order) => {
    let best: number | null = null;
    for (const keyword of keywords[key] ?? []) {
      const score = scoreOf(target, normalize(keyword));
      if (score !== null && (best === null || score < best)) best = score;
    }
    if (best !== null) scored.push({ key, score: best, order });
  });
  return scored
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.key);
}
