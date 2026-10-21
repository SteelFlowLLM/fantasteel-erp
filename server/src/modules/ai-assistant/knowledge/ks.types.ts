/** KS 규격 정리(docs/notion/07)의 `## N. 제목` 한 절. 심층 조사가 사내 지식 출처로 읽는다 */
export interface KsSection {
  /** KS-8, KS-7-1 (문서의 절 번호) */
  id: string;
  /** 절 제목 (예: 강종별 기준값 (SPHC·SS275·SM355A)) */
  title: string;
  /** 절 본문 (마크다운 표 그대로) */
  text: string;
}
