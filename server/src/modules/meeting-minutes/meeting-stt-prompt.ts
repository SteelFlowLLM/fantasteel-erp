/**
 * whisper 용어 힌트(initial prompt) 상한 (🟡 가정값, 이슈 #522). whisper는 앞 문맥을 224토큰까지만 보고 넘치면 앞을 버린다.
 * 한국어는 한 글자가 대개 1토큰 이상이라 넉넉히 줄였다
 */
export const STT_PROMPT_MAX_CHARS = 200;

/** 용어 사전(docs/notion/03)의 공정·제품 용어 가운데 회의에 자주 나오고 일상어와 헷갈리기 쉬운 것 (🟡 가정: 고른 목록) */
export const STT_GLOSSARY_TERMS: readonly string[] = ['제선', '제강', '연주', '열연', '고로', '전로', '용선', '히트', '슬래브', '코일', '합금철', '여재', '밀시트', '이론중량'];

export interface SttPromptInput {
  attendeeNames: readonly string[];
  steelGradeCodes: readonly string[];
  rawMaterials: readonly { itemName: string; itemCode: string }[];
  customerNames: readonly string[];
  supplierNames: readonly string[];
  glossaryTerms?: readonly string[];
}

/**
 * 회의 전사에 줄 용어 힌트: "참석자 김도윤, 박서영. 강종 SS275, SM355A. 원료 철광석 ORE01. 고객사 …. 공급업체 …. 용어 열연, 슬래브."
 * whisper가 강종 코드·회사·사람 이름을 비슷한 소리의 다른 말로 받아 적지 않게 한다. 중요한 묶음부터 넣고 상한을 넘는 낱말은 뺀다.
 * 힌트는 음성 서버에만 가고 저장하지 않는다
 */
export function buildSttPrompt(input: SttPromptInput, maxChars: number = STT_PROMPT_MAX_CHARS): string | null {
  const groups: [string, readonly string[]][] = [
    ['참석자', input.attendeeNames],
    ['강종', input.steelGradeCodes],
    ['원료', input.rawMaterials.map((item) => `${item.itemName} ${item.itemCode}`)],
    ['고객사', input.customerNames],
    ['공급업체', input.supplierNames],
    ['용어', input.glossaryTerms ?? STT_GLOSSARY_TERMS],
  ];
  const sentences: string[] = [];
  let length = 0;
  for (const [label, words] of groups) {
    const picked: string[] = [];
    for (const word of new Set(words.map((w) => w.replace(/\s+/g, ' ').trim()).filter((w) => w !== ''))) {
      const sentence = `${label} ${[...picked, word].join(', ')}.`;
      // 문장 사이 띄어쓰기 한 칸을 같이 센다
      if (length + (sentences.length > 0 ? 1 : 0) + sentence.length > maxChars) continue;
      picked.push(word);
    }
    if (picked.length === 0) continue;
    const sentence = `${label} ${picked.join(', ')}.`;
    length += (sentences.length > 0 ? 1 : 0) + sentence.length;
    sentences.push(sentence);
  }
  return sentences.length > 0 ? sentences.join(' ') : null;
}
