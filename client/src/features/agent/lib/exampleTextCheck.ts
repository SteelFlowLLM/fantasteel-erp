// 준비 중 예시 화면의 고정 문구를 문서 기준으로 점검하는 순수 함수 (테스트에서 쓴다).
// 금지어 = 용어 사전(03)의 '금지어' 열 + PLAN 6장 기본값. 번호 형식 = 업무 프로세스 9.1·9.2.

/** 용어 사전 금지어 중 화면 문구에 나올 수 있는 것 (영문 코드 값과 겹치는 RESERVED·SHIPPED·HOLD는 뺐다) */
export const FORBIDDEN_WORDS: readonly string[] = [
  '@ERP Assistant', 'ERP Assistant', 'Company Memory', 'ERP 거래 초안', 'Allocation', 'Heat LOT', 'LOT 계보', 'LOT 계층',
  '가용 재고', '가용량', '감사 로그', '감사 이력', '거래처', '검사 기준서', '결정 재현', '공급사', '공정 실적', '공정별 검사',
  '구매 요청', '대응안', '대화 → ERP', '레시피', '로트', '배합', '비즈니스 이벤트', '생산 실적', '선점', '성적서',
  '수주별 채팅방', '슬라브', '승인 권한자', '실행 초안', '역방향 추적', '오더', '원자재', '잉여재고', '잔재',
  '정방향 추적', '주문', '챗봇', '출하 확정', '팀장', '품질 사례 DB', '필요량', '할당', '협력사', '회의 → 업무',
  // PLAN 6장 기본값
  '대화방', '출하번호',
];

/** 'AI' 없이 쓴 'Factory Agent' (TRM-104 금지어) */
const BARE_FACTORY_AGENT = /(?<!AI )Factory Agent/;
/** 'SM355' 단독 표기 (강종은 SM355A~D, REQ-MST-002) */
const BARE_SM355 = /SM355(?![A-D])/;

/** 객체·배열 안의 모든 문자열을 모은다 */
export function collectTexts(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectTexts(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectTexts(item, out));
  return out;
}

/** 문구에서 찾은 금지 표기 목록 (없으면 빈 배열) */
export function findForbiddenWords(texts: readonly string[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const word of FORBIDDEN_WORDS) if (text.includes(word)) found.add(word);
    if (BARE_FACTORY_AGENT.test(text)) found.add('Factory Agent');
    if (BARE_SM355.test(text)) found.add('SM355');
  }
  return [...found];
}

/** 9.1 업무 번호 (SO-YYMM-NNN · PP/PR/PO/GR/DR-YYMM-NNNN · EV-YYMMDD-NNN) */
export const BUSINESS_NO_PATTERN = /\b(?:SO-\d{4}-\d{3}|(?:PP|PR|PO|GR|DR)-\d{4}-\d{4}|EV-\d{6}-\d{3})\b/g;
/** 9.2 LOT 번호 (원료·용선·히트·슬래브·코일) */
export const LOT_NO_PATTERN = /\b(?:RM-[A-Z]{3}\d{2}-\d{6}-\d{3}|HM-BF\d-\d{6}-\d{2}|HT-BOF\d-\d{6}-\d{3}(?:-\d{2})?|CBOF\d-\d{6}-\d{3}-\d{2})\b/g;
/** 번호처럼 보이는 모든 표기 (형식 검사 대상) */
const NUMBER_LIKE = /\b(?:SO|PP|PR|PO|GR|DR|EV|RM|HM|HT|MS)-[A-Z0-9-]+|\bC[A-Z]*\d[\d-]*\d\b/g;

/** 9.1·9.2 형식에 맞지 않는 번호 표기 목록 */
export function findMalformedNumbers(texts: readonly string[]): string[] {
  const bad: string[] = [];
  for (const text of texts) {
    for (const match of text.match(NUMBER_LIKE) ?? []) {
      const ok = new RegExp(`^(?:${BUSINESS_NO_PATTERN.source}|${LOT_NO_PATTERN.source})$`).test(match);
      if (!ok) bad.push(match);
    }
  }
  return bad;
}
