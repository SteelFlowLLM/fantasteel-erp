// 철강맨AI 입력칸 / 명령 (이슈 #410, 문서에 없는 기능): 입력칸 맨 앞에서 /를 치면 명령 고르기 창을 열고, 보낼 때 명령과 질문을 가른다.
// 명령은 아래 다섯 낱말과 똑같을 때만이다. 다른 글(/usr 경로 등)은 보통 질문으로 보내고, 명령 낱말을 글로 보내려면 //로 시작한다.

export type AiSlashCommandKey = 'research' | 'web' | 'browser' | 'newChat' | 'threads';

export interface AiSlashCommand {
  key: AiSlashCommandKey;
  /** / 뒤에 치는 낱말 */
  name: string;
  /** true면 `/이름 질문`으로 쓰고, false면 고르는 대로 바로 한다 */
  takesQuestion: boolean;
  description: string;
  /** 입력칸이 이 명령으로 시작할 때 입력칸 아래에 보이는 안내 */
  hint: string;
}

export const AI_SLASH_COMMANDS: readonly AiSlashCommand[] = [
  { key: 'research', name: '조사', takesQuestion: true, description: '바로 심층 조사를 만들어요', hint: 'Enter를 누르면 이 질문으로 심층 조사를 만들어요' },
  { key: 'web', name: '웹', takesQuestion: true, description: '이번 질문만 웹 검색을 켜고 물어요', hint: '이번 질문만 웹 검색을 켜고 보내요' },
  { key: 'browser', name: '브라우저', takesQuestion: true, description: '이번 질문만 브라우저를 켜고 물어요', hint: '이번 질문만 브라우저를 켜고 보내요' },
  { key: 'newChat', name: '새대화', takesQuestion: false, description: '새 대화를 시작해요', hint: 'Enter를 누르면 새 대화를 시작해요' },
  { key: 'threads', name: '목록', takesQuestion: false, description: '지난 대화 목록을 열어요', hint: 'Enter를 누르면 대화 목록을 열어요' },
];

export const AI_SLASH_NEED_QUESTION = '명령 뒤에 질문을 적어 주세요';
export const AI_SLASH_ESCAPED_HINT = '명령이 아니라 글 그대로 보내요';

/** 고르기 창의 사용법 줄 */
export const slashUsage = (command: AiSlashCommand): string => `/${command.name}${command.takesQuestion ? ' 질문' : ''}`;

/** 고르기 창에서 질문을 받는 명령을 고르면 입력칸에 채울 글 */
export const slashCompletion = (command: AiSlashCommand): string => `/${command.name} `;

/**
 * 고르기 창을 열 검색어: 첫 글자가 /이고 아직 띄어쓰기 전이면 / 뒤의 글, 아니면 null.
 * //로 시작하면 글 그대로 보내려는 것이라 열지 않는다.
 */
export function slashQueryOf(draft: string): string | null {
  if (!draft.startsWith('/') || draft.startsWith('//')) return null;
  const query = draft.slice(1);
  return /\s/.test(query) ? null : query;
}

// 한글은 두벌식 자판에서 친 낱자 순서로 견준다. 조합 중인 '/조ㅅ', 받침이 다음 글자로 넘어가기 전인 '/샏'(새대)·'/블'(브라)도 이어서 맞게 한다
const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNGSEONG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅗㅏ', 'ㅗㅐ', 'ㅗㅣ', 'ㅛ', 'ㅜ', 'ㅜㅓ', 'ㅜㅔ', 'ㅜㅣ', 'ㅠ', 'ㅡ', 'ㅡㅣ', 'ㅣ'];
const JONGSEONG = ['', 'ㄱ', 'ㄲ', 'ㄱㅅ', 'ㄴ', 'ㄴㅈ', 'ㄴㅎ', 'ㄷ', 'ㄹ', 'ㄹㄱ', 'ㄹㅁ', 'ㄹㅂ', 'ㄹㅅ', 'ㄹㅌ', 'ㄹㅍ', 'ㄹㅎ', 'ㅁ', 'ㅂ', 'ㅂㅅ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const COMPOUND_JAMO: Record<string, string> = {
  ㄳ: 'ㄱㅅ', ㄵ: 'ㄴㅈ', ㄶ: 'ㄴㅎ', ㄺ: 'ㄹㄱ', ㄻ: 'ㄹㅁ', ㄼ: 'ㄹㅂ', ㄽ: 'ㄹㅅ', ㄾ: 'ㄹㅌ', ㄿ: 'ㄹㅍ', ㅀ: 'ㄹㅎ', ㅄ: 'ㅂㅅ',
  ㅘ: 'ㅗㅏ', ㅙ: 'ㅗㅐ', ㅚ: 'ㅗㅣ', ㅝ: 'ㅜㅓ', ㅞ: 'ㅜㅔ', ㅟ: 'ㅜㅣ', ㅢ: 'ㅡㅣ',
};
const SYLLABLE_FIRST = 0xac00;
const SYLLABLE_LAST = 0xd7a3;

/** 글을 두벌식 자판에서 치는 낱자 순서로 푼다 (한글이 아닌 글자는 소문자로 그대로) */
export function hangulKeystrokes(text: string): string {
  let keys = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= SYLLABLE_FIRST && code <= SYLLABLE_LAST) {
      const index = code - SYLLABLE_FIRST;
      keys += CHOSEONG[Math.floor(index / 588)] + JUNGSEONG[Math.floor((index % 588) / 28)] + JONGSEONG[index % 28];
    } else {
      keys += COMPOUND_JAMO[char] ?? char.toLowerCase();
    }
  }
  return keys;
}

/** 검색어로 시작하는 명령 (빈 검색어면 전부, 정해 둔 순서 그대로) */
export function filterSlashCommands(query: string): AiSlashCommand[] {
  const keys = hangulKeystrokes(query);
  return AI_SLASH_COMMANDS.filter((command) => hangulKeystrokes(command.name).startsWith(keys));
}

export type AiSlashDraft =
  /** 명령. question은 앞뒤 빈칸을 뺀 질문 (질문을 받지 않는 명령이면 뒤에 적은 글) */
  | { kind: 'command'; command: AiSlashCommand; question: string }
  /** 보통 질문. escaped면 //로 시작해 앞의 /를 하나 뺀 글이다 */
  | { kind: 'text'; text: string; escaped: boolean };

const findCommand = (draft: string): { command: AiSlashCommand; question: string } | null => {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(draft);
  const command = match ? AI_SLASH_COMMANDS.find((c) => c.name === match[1]) : undefined;
  return command ? { command, question: (match?.[2] ?? '').trim() } : null;
};

/** 보낼 글을 명령과 질문으로 가른다. 첫 글자가 /일 때만 명령이다. //명령 은 명령이 아니라 앞의 /를 하나 뺀 글이다 (//주석처럼 명령 낱말이 아니면 그대로) */
export function parseSlashDraft(draft: string): AiSlashDraft {
  if (draft.startsWith('//') && findCommand(draft.slice(1))) return { kind: 'text', text: draft.slice(1), escaped: true };
  const found = findCommand(draft);
  return found ? { kind: 'command', ...found } : { kind: 'text', text: draft, escaped: false };
}
