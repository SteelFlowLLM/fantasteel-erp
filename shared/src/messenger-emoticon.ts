// 이모티콘 화면 기능 (23번, 문서에 없는 추가 기능): 글자로 추천 낱말, 작은 철강맨 반응, 글 속 작은 이모티콘.
// MESSAGE_EMOTICONS 목록과 따로 둔다. 다른 작업이 목록에 이모티콘을 더할 때 겹쳐 고치지 않게 하려고
import { MESSAGE_EMOTICONS, isMessageEmoticonKey, type MessageEmoticonKey, type MessageReactionEmoji } from './messenger';

/**
 * 글자로 추천 (23번): 입력창 글에 이 낱말이 있으면 그 이모티콘을 입력창 위에 추천한다 (가정값).
 * 비교할 때 대소문자·띄어쓰기·마침표 등은 무시한다. 한 글자 낱말은 글이 그 글자로 시작할 때만 맞는다.
 * 키가 없는 이모티콘은 추천하지 않는다 (새로 더한 이모티콘은 낱말을 따로 더한다)
 */
export const MESSAGE_EMOTICON_KEYWORDS: Partial<Record<MessageEmoticonKey, readonly string[]>> = {
  'steelman-ok': ['확인', '오케이', '오키', 'ok', '알겠'],
  'steelman-yes': ['넵', '네', '넹', '예스', 'yes'],
  'steelman-thanks': ['감사', '고마워', '고맙', '땡큐', 'thanks', 'thx'],
  'steelman-sorry': ['죄송', '미안', '쏘리', 'sorry'],
  'steelman-approve': ['결재', '승인'],
  'steelman-best': ['최고', '짱', '굿', 'good', 'best'],
  'steelman-gasp': ['헉', '헐', '깜짝'],
  'steelman-off': ['퇴근', '칼퇴'],
  'steelman-checking': ['확인중', '확인해볼게', '확인해 볼게', '체크중'],
  'steelman-review': ['검토', '봐주세요', '부탁'],
  'steelman-reject': ['반려', '다시 해'],
  'steelman-done': ['완료', '끝', '다했', 'done'],
  'steelman-urgent': ['긴급', '급해', '급함', 'asap'],
  'steelman-wait': ['잠시만', '잠깐', '기다려'],
  'steelman-fighting': ['화이팅', '파이팅', '힘내'],
  'steelman-well-done': ['수고', '고생'],
  'steelman-hot-rolling': ['열연', '열일', '바빠'],
  'steelman-strike': ['단김에', '당장'],
  'steelman-neat': ['알잘딱', '깔끔'],
  'steelman-decline': ['거절', '어렵겠'],
  'steelman-safety-first': ['안전', '조심'],
  'steelman-point-check': ['확인 좋아', '이상무', '지적확인'],
  'steelman-pass': ['합격', '통과', 'pass'],
  'steelman-fail': ['불합격', '탈락', '불량', 'fail'],
  'steelman-on-time': ['납기', '출하'],
  'steelman-lunch': ['점심', '식사', '밥'],
  'steelman-away': ['자리 비움', '부재'],
  'steelman-meeting': ['회의', '미팅'],
  'steelman-outside': ['외근', '출장'],
  'steelman-panic': ['멘붕', '망했', '큰일'],
  'steelman-lol': ['ㅋㅋ', 'ㅎㅎ', '웃겨', 'lol'],
  'steelman-love': ['사랑', '하트', 'love'],
  'steelman-hungry': ['배고파', '배고프'],
  'steelman-coffee': ['커피', '카페인'],
  'steelman-monday': ['월요일', '월욜'],
  'steelman-friday': ['불금', '금요일', '주말'],
  'steelman-sleepy': ['졸려', '졸리', '피곤'],
  'steelman-cry': ['ㅠㅠ', 'ㅜㅜ', '슬퍼', '눈물'],
  'steelman-angry': ['화나', '열받', '부글'],
  'steelman-wow': ['대박', '와우', 'wow'],
  'steelman-morning': ['굿모닝', '좋은 아침', '안녕하세요'],
  'steelman-yummy': ['맛있', '군침', '냠냠'],
  'steelman-cold-no': ['싫어', '안 돼', '안돼'],
  'steelman-rolled': ['압연', '털렸'],
  'steelman-quench': ['담금질', '단련'],
  'steelman-wall': ['철벽', '방어'],
  'steelman-steel-mind': ['멘탈', '버텨'],
  'steelman-melting': ['녹는', '녹아', '더워'],
  'steelman-shaka': ['좋다', '좋아', '나이스', 'nice'],
  'steelman-yar': ['야르', '신난다', '신나'],
  'steelman-hallelujah': ['할렐', '다행'],
  'steelman-sense': ['감다살', '센스'],
  'steelman-no-sense': ['감다뒤', '감 떨어'],
  'steelman-unbroken': ['중꺾마', '포기'],
  'steelman-even-better': ['오히려', '럭키'],
  'steelman-iced': ['얼죽아', '아이스', '아아'],
  'steelman-ominous': ['불길', '쎄하'],
  'steelman-inner-voice': ['겉과 속', '속마음'],
  'steelman-lazy-reply': ['ㅇㅇ', 'ㅇㅋ', '대충'],
  'steelman-nep-nep': ['넵넵', '넵병', '네네'],
  'steelman-office-ghost': ['야근', '지박령', '철야'],
  'steelman-lunch-menu': ['뭐 먹지', '메뉴', '점메추'],
  'steelman-huh': ['예?', '네?', '뭐라고'],
  'steelman-um': ['엄', '음', '흠', '글쎄'],
  'steelman-no-no': ['아뇨', '아니요', '노노'],
  'steelman-gg': ['줴줴', 'gg', '지지'],
  'steelman-t-one': ['티원', 't1'],
  'steelman-yoi': ['요이', '요오', '준비'],
  'steelman-new-year': ['새해', '복 많이'],
  'steelman-seollal': ['설날', '세배'],
  'steelman-chuseok': ['추석', '한가위', '송편'],
  'steelman-year-end': ['연말', '올해도', '송년'],
  'steelman-birthday': ['생일', '생축', 'hbd'],
  'steelman-welcome': ['환영', '어서 와', '웰컴'],
  // 22번 5차
  'steelman-nep': ['넵!', '알겠습니다'],
  'steelman-inspected': ['점검', '체크 완료'],
  'steelman-tbm': ['tbm', '작업 전 회의'],
  'steelman-near-miss': ['아차', '아찔'],
  'steelman-tapping': ['출선', '쇳물'],
  'steelman-praise': ['칭찬', '잘했'],
  'steelman-shipped': ['출고', '출고 확정'],
  'steelman-goal': ['목표 달성', '달성', '실적'],
  'steelman-shipping': ['출하', '배송'],
  'steelman-overtime': ['야근', '늦게까지'],
  'steelman-nep-soulless': ['넵…', '넵...'],
  'steelman-nee': ['네에', '네~'],
  'steelman-neng': ['넹', '네엥'],
  'steelman-okay': ['ㅇㅋ', '오키'],
  'steelman-gogo': ['ㄱㄱ', '고고', '가자'],
  'steelman-heol': ['헐'],
  'steelman-kingbat': ['킹받', '열받'],
  'steelman-out-of-mind': ['정신 나감', '정신없'],
  'steelman-rusty': ['녹슬', '지쳤'],
  'steelman-error': ['오류', '에러', '버그'],
  'steelman-cheers': ['짠', '건배'],
  'steelman-high-five': ['하이파이브'],
  'steelman-payday': ['월급', '월급날'],
  'steelman-leave-on-time': ['칼퇴', '정시 퇴근'],
  'steelman-weekend-gone': ['주말 순삭', '주말 끝'],
  'steelman-envy': ['부럽', '부러워'],
  'steelman-eh': ['엥'],
  'steelman-stop-it': ['그만', '그만해'],
  'steelman-reality-check': ['현타'],
  'steelman-fuss': ['요들갑', '호들갑'],
  'steelman-serious': ['진지'],
  'steelman-bobflix': ['밥플릭스', '밥 먹으며'],
  'steelman-flex': ['플렉스', 'flex'],
  'steelman-clap': ['박수', '짝짝'],
  'steelman-coil-dog': ['코일이', '멍멍', '강아지'],
  'steelman-slab-cat': ['냥이', '고양이', '기지개'],
  'steelman-promotion': ['승진'],
  'steelman-christmas': ['크리스마스', '메리 크리스마스', '성탄'],
  'steelman-hot': ['더워', '덥다'],
  'steelman-cold': ['추워', '춥다'],
  'steelman-vacation': ['휴가', '여행'],
  'steelman-congrats': ['축하'],
};

// ── 작은 철강맨 반응 (23번) ─────────────

/** 반응 값('sm:…', MESSAGE_REACTION_EMOJIS) → 그림으로 쓰는 이모티콘. 순서가 반응 고르기 줄 순서다 */
export const STEELMAN_REACTIONS = [
  { value: 'sm:ok', emoticonKey: 'steelman-ok' },
  { value: 'sm:thanks', emoticonKey: 'steelman-thanks' },
  { value: 'sm:lol', emoticonKey: 'steelman-lol' },
  { value: 'sm:love', emoticonKey: 'steelman-love' },
] as const satisfies readonly { value: MessageReactionEmoji; emoticonKey: MessageEmoticonKey }[];

/** 철강맨 반응이면 그 이모티콘 키, 글자 이모지면 null */
export function reactionEmoticonKey(value: string): MessageEmoticonKey | null {
  return STEELMAN_REACTIONS.find((r) => r.value === value)?.emoticonKey ?? null;
}

/** 반응을 글로 읽을 때 (화면 읽기 프로그램·마우스 올림): 이모지는 그대로, 철강맨은 '철강맨 확인' */
export function reactionLabel(value: string): string {
  const key = reactionEmoticonKey(value);
  if (!key) return value;
  return `철강맨 ${MESSAGE_EMOTICONS.find((e) => e.key === key)?.label ?? ''}`.trim();
}

// ── 글 속 작은 이모티콘 (23번) ─────────────
// 본문에 ':키:'(예 ':steelman-ok:')로 적으면 화면이 그 자리에 작은 그림을 그린다. 저장은 글 그대로라 스키마가 그대로다.

const INLINE_EMOTICON_PATTERN = /:(steelman-[a-z0-9-]+):/g;

/** 본문에 넣는 글 (':steelman-ok:') */
export const inlineEmoticonToken = (key: MessageEmoticonKey): string => `:${key}:`;

export type InlineEmoticonPart = { kind: 'text'; text: string } | { kind: 'emoticon'; key: MessageEmoticonKey; text: string };

/** 본문을 글과 작은 이모티콘으로 나눈다. 모르는 키(목록에 없는 것)는 글로 둔다 */
export function splitInlineEmoticons(content: string): InlineEmoticonPart[] {
  const parts: InlineEmoticonPart[] = [];
  let buffer = '';
  let last = 0;
  for (const match of content.matchAll(INLINE_EMOTICON_PATTERN)) {
    const key = match[1];
    if (!isMessageEmoticonKey(key)) continue;
    buffer += content.slice(last, match.index);
    if (buffer) parts.push({ kind: 'text', text: buffer });
    buffer = '';
    parts.push({ kind: 'emoticon', key, text: match[0] });
    last = match.index + match[0].length;
  }
  buffer += content.slice(last);
  if (buffer) parts.push({ kind: 'text', text: buffer });
  return parts;
}

/** 본문의 작은 이모티콘 키 (나온 순서, 같은 키는 한 번만) */
export function inlineEmoticonKeys(content: string): MessageEmoticonKey[] {
  const keys: MessageEmoticonKey[] = [];
  for (const part of splitInlineEmoticons(content)) {
    if (part.kind === 'emoticon' && !keys.includes(part.key)) keys.push(part.key);
  }
  return keys;
}

/** 미리보기(목록·알림·답글·공지)용 글: ':steelman-ok:' → '(확인)'. 모르는 키는 그대로 */
export function inlineEmoticonText(content: string): string {
  return content.replace(INLINE_EMOTICON_PATTERN, (whole: string, key: string) => {
    const found = MESSAGE_EMOTICONS.find((e) => e.key === key);
    return found ? `(${found.label})` : whole;
  });
}
