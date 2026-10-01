// 한국어 조사 붙이기: 앞 글자의 받침에 따라 '을/를', '은/는', '이/가', '과/와', '으로/로'를 고른다.
// 화면 안내 문구(예: "사원번호를 입력해 주세요", "이름을 입력해 주세요")에 쓴다.

/** 숫자를 한국어로 읽을 때 받침이 있는지 (0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔) */
const DIGIT_HAS_BATCHIM: Record<string, boolean> = { 0: true, 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: true, 8: true, 9: false };

export function hasBatchim(word: string): boolean {
  const last = word.trim().replace(/[)\]」』"'’”\s]+$/u, '').slice(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/\d/.test(last)) return DIGIT_HAS_BATCHIM[last] ?? false;
  // 영문 약어는 끝 글자를 읽는 소리로 본다 (L 엘, M 엠, N 엔, R 알)
  return /[lmnrLMNR]/.test(last);
}

const pick = (word: string, withBatchim: string, withoutBatchim: string) => `${word}${hasBatchim(word) ? withBatchim : withoutBatchim}`;

/** 사원번호를 · 이름을 */
export const withEulReul = (word: string): string => pick(word, '을', '를');
/** 사원번호는 · 이름은 */
export const withEunNeun = (word: string): string => pick(word, '은', '는');
/** 사원번호가 · 이름이 */
export const withIGa = (word: string): string => pick(word, '이', '가');
/** 부서와 · 직급과 */
export const withGwaWa = (word: string): string => pick(word, '과', '와');

/** 받침이 ㄹ인지 (ㄹ 받침 뒤에는 '으로' 대신 '로'). 숫자는 1 일·7 칠·8 팔, 영문은 L 엘·R 알 */
function endsWithRieul(word: string): boolean {
  const last = word.trim().replace(/[)\]」』"'’”\s]+$/u, '').slice(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 8;
  if (/\d/.test(last)) return last === '1' || last === '7' || last === '8';
  return /[lrLR]/.test(last);
}

/** 초안 #3으로 · 부서로 · 서울로 (ㄹ 받침은 '로') */
export const withEuroRo = (word: string): string => `${word}${hasBatchim(word) && !endsWithRieul(word) ? '으로' : '로'}`;
