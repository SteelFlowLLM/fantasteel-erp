/** 용어 사전 한 줄 (docs/notion/03-용어-사전.md). 근거·DB명·비고 칸은 답에 쓰지 않아 뺐다 */
export interface GlossaryTerm {
  /** TRM-056 */
  id: string;
  /** 용어 사전 장 제목 (예: 재고·예약·배정) */
  section: string;
  /** 구분 (개념·엔티티·공정 …) */
  kind: string;
  /** 한글명 */
  name: string;
  englishName: string | null;
  abbreviation: string | null;
  /** 예: reservation, item / itemCode */
  variableName: string | null;
  definition: string;
  businessRule: string | null;
  relatedTerms: string[];
  /** 동의어(사용 금지). 사용자가 이 말로 물어도 이 용어를 찾는다 */
  forbiddenSynonyms: string[];
}
