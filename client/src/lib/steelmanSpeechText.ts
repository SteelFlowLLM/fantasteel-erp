// 철강맨 말하기 1단계 (이슈 #507, 문서에 없는 기능): 철강맨AI 답 글을 브라우저 음성이 읽기 좋은 글로 바꾼다.
// 화면에 보이는 것 중 소리로 읽으면 어색한 것(마크다운 기호·표·코드 블록·링크 주소·출처 표시)은 빼고,
// 긴 답은 앞부분만 읽고 "자세한 건 화면에 있어요"로 끝낸다. 목소리·재생은 lib/steelmanSpeech.ts.

/** 읽는 글의 가장 긴 길이 (가정값). 이보다 길면 문장 끝에서 자르고 안내 말로 끝낸다 */
export const SPEAK_MAX_CHARS = 300;
/** 다 읽지 않았을 때 끝에 붙이는 말 */
export const SPEAK_MORE_ON_SCREEN = '자세한 건 화면에 있어요.';
/** 목소리 한 번에 맡기는 글자 수. 긴 글을 한 번에 맡기면 브라우저가 중간에 멈추는 일이 있어 문장 단위로 나눈다 */
export const SPEAK_CHUNK_CHARS = 140;

export interface SpeechText {
  /** 읽을 글. 읽을 것이 없으면 빈 글 */
  text: string;
  /** 답의 일부(뒷부분·표·코드 블록)를 읽지 않았다. text 끝에 SPEAK_MORE_ON_SCREEN이 붙어 있다 */
  truncated: boolean;
}

// 숫자 뒤에 오는 단위를 소리 나는 대로. 대문자 T는 철판 두께(5T)일 수 있고 소문자 t도 그래서 건드리지 않는다 ("톤"은 답에 한글로 온다)
const UNIT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(\d)\s*(?:㎡|m²)/g, '$1 제곱미터'],
  [/(\d)\s*(?:㎥|m³)/g, '$1 세제곱미터'],
  [/(\d)\s*(?:㎜|mm)(?![A-Za-z])/g, '$1 밀리미터'],
  [/(\d)\s*(?:㎝|cm)(?![A-Za-z])/g, '$1 센티미터'],
  [/(\d)\s*(?:㎞|km)(?![A-Za-z])/g, '$1 킬로미터'],
  [/(\d)\s*(?:㎏|kg)(?![A-Za-z])/g, '$1 킬로그램'],
  [/(\d)\s*(?:tons?|TON)(?![A-Za-z])/g, '$1 톤'],
  [/(\d)\s*kWh(?![A-Za-z])/g, '$1 킬로와트시'],
  [/(\d)\s*kW(?![A-Za-z])/g, '$1 킬로와트'],
  [/(\d)\s*MPa(?![A-Za-z])/g, '$1 메가파스칼'],
  [/(\d)\s*m(?![A-Za-z²³])/g, '$1 미터'],
  [/(\d)\s*(?:℃|°\s*C)/g, '$1도'],
  [/(\d)\s*%/g, '$1 퍼센트'],
];

/**
 * 숫자·단위·날짜를 목소리가 자연스럽게 읽는 모양으로 (한 줄 안에서만 쓴다):
 * 2026-10-22 → 2026년 10월 22일, 1,200 → 1200, 12.500톤 → 12.5 톤, 3mm → 3 밀리미터, 85% → 85 퍼센트, 10~20 → 10에서 20, 1219×2438 → 1219 곱하기 2438
 */
export function speakableNumbers(line: string): string {
  let text = line
    .replace(/(?<![\d-])(\d{4})[-.](\d{1,2})[-.](\d{1,2})(?!\d)/g, (_, y: string, m: string, d: string) => `${y}년 ${Number(m)}월 ${Number(d)}일`)
    .replace(/\d{1,3}(?:,\d{3})+(?!\d)/g, (found) => found.replace(/,/g, ''))
    // 소수 셋째 자리까지 쓰는 톤(12.500)을 "십이 점 오영영"으로 읽지 않게 끝의 0을 뗀다. 2026.10.22 같은 점 둘 이상은 건드리지 않는다
    .replace(/(?<![\d.])(\d+)\.(\d+)(?!\d|\.\d)/g, (_, whole: string, fraction: string) => {
      const trimmed = fraction.replace(/0+$/, '');
      return trimmed ? `${whole}.${trimmed}` : whole;
    });
  for (const [pattern, spoken] of UNIT_PATTERNS) text = text.replace(pattern, spoken);
  return text
    .replace(/(\d)\s*[~～]\s*(?=\d)/g, '$1에서 ')
    .replace(/(\d)\s*[×xX]\s*(?=\d)/g, '$1 곱하기 ')
    .replace(/\s*(?:→|⇒|->|=>)\s*/g, ', ')
    .replace(/[~～]/g, ' ')
    .replace(/\s{2,}/g, ' ');
}

/** 한 줄에서 마크다운 꾸밈과 읽을 수 없는 것을 뺀다. 링크는 모델이 출처로 붙이는 것이라(서버 규칙 W4) 글자까지 뺀다 */
function cleanInline(line: string): string {
  return (
    line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')
      .replace(/\bhttps?:\/\/\S+/gi, '')
      .replace(/\bwww\.\S+/gi, '')
      // 서버가 지우고 남은 출처 표시: [TRM-056] · [TRM-056, TRM-060]
      .replace(/\[\s*[A-Z]{2,5}-\d{2,}(?:\s*,\s*[A-Z]{2,5}-\d{2,})*\s*\]/g, '')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/__([^_\n]+)__/g, '$1')
      .replace(/~~([^~\n]+)~~/g, '$1')
      .replace(/`([^`\n]*)`/g, '$1')
      .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '$1')
      .replace(/[*`]/g, '')
      // 이모지는 소리로 읽으면 이름("웃는 얼굴")이 나온다
      .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** 표의 줄: 위아래 선(|---|---|)과 칸 줄(| a | b |). 앞 | 없이 쓴 표도 | 가 둘 이상이면 표로 본다 */
function isTableLine(raw: string): boolean {
  if (/^\s*\|/.test(raw)) return true;
  if (/^\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+$/.test(raw)) return true;
  return (raw.match(/\|/g)?.length ?? 0) >= 2;
}

const SENTENCE_END = /[.!?…。]["')\]”’]*$/;

/** 한 줄이 문장으로 끝나게: 목록 줄 사이에서 목소리가 쉬도록 마침표를 붙인다 */
function endSentence(line: string): string {
  if (SENTENCE_END.test(line)) return line;
  return `${line.replace(/[:：,;，；]+$/, '')}.`;
}

/** 목소리 한 번에 맡길 만큼 문장 끝에서 나눈다. 소수점·"12.5"는 뒤에 공백이 없어 나뉘지 않는다 */
export function splitForSpeech(text: string, limit = SPEAK_CHUNK_CHARS): string[] {
  const sentences = text.split(/(?<=[.!?…。])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  const push = (part: string): void => {
    let rest = part;
    while (rest.length > limit) {
      const space = rest.lastIndexOf(' ', limit);
      const cut = space > limit / 2 ? space : limit;
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) chunks.push(rest);
  };
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + 1 + sentence.length > limit) {
      push(current);
      current = sentence;
    } else current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) push(current);
  return chunks;
}

/** 첫 줄이 너무 길 때 문장 끝(없으면 띄어쓰기)에서 자른다 */
function cutLong(line: string, limit: number): string {
  if (line.length <= limit) return line;
  const head = line.slice(0, limit);
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('… '));
  if (sentenceEnd > limit / 2) return head.slice(0, sentenceEnd + 1);
  const space = head.lastIndexOf(' ');
  return endSentence(space > limit / 2 ? head.slice(0, space) : head);
}

/**
 * 철강맨AI 답 글에서 소리로 읽을 글을 만든다.
 * - 코드 블록·표·링크(주소와 글자)·출처 표시·마크다운 기호·이모지는 뺀다. 표나 코드 블록을 뺐으면 끝에 안내 말을 붙인다.
 * - 줄(목록 항목 포함)을 앞에서부터 더해 SPEAK_MAX_CHARS 안에서 끝내고, 다 못 읽으면 SPEAK_MORE_ON_SCREEN으로 끝낸다.
 * - 읽을 글이 하나도 없는데 답이 있었으면 안내 말만 읽는다.
 */
export function speechTextOf(content: string, maxChars = SPEAK_MAX_CHARS): SpeechText {
  const source = content.replace(/\r\n?/g, '\n');
  let omitted = false;
  const withoutCode = source.replace(/(```|~~~)[\s\S]*?(?:\1|$)/g, () => {
    omitted = true;
    return '\n';
  });
  const lines: string[] = [];
  for (const raw of withoutCode.split('\n')) {
    if (isTableLine(raw)) {
      omitted = true;
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(raw)) continue;
    const plain = raw
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*>+\s?/, '')
      .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '');
    const cleaned = speakableNumbers(cleanInline(plain));
    if (/[\p{L}\p{N}]/u.test(cleaned)) lines.push(endSentence(cleaned));
  }
  if (!lines.length) return omitted || content.trim() ? { text: SPEAK_MORE_ON_SCREEN, truncated: true } : { text: '', truncated: false };

  const picked: string[] = [];
  let length = 0;
  let cutFirst = false;
  for (const line of lines) {
    const next = length + (picked.length ? 1 : 0) + line.length;
    if (picked.length && next > maxChars) break;
    if (!picked.length && line.length > maxChars) {
      picked.push(cutLong(line, maxChars));
      cutFirst = true;
      break;
    }
    picked.push(line);
    length = next;
  }
  const truncated = omitted || cutFirst || picked.length < lines.length;
  const body = picked.join('\n');
  return { text: truncated ? `${body}\n${SPEAK_MORE_ON_SCREEN}` : body, truncated };
}
