// KS 규격 정리(docs/notion/07)의 절을 질문 글로 찾는다. 심층 조사의 사내 지식 출처(이슈 #484)와 철강맨AI의 read_knowledge(이슈 #506)가 함께 쓴다. LLM을 부르지 않는다.
import { KS_SECTIONS } from './ks.generated';
import type { KsSection } from './ks.types';

/** 찾을 때 빼는 절: 문서 작업 메모라 근거가 아니다 */
export const KS_SKIP: ReadonlySet<string> = new Set(['KS-9', 'KS-10']);

/** 한 번에 고르는 절 수의 기본값 (심층 조사의 사내 지식 넣기와 같은 값, 이슈 #484) */
export const KS_SEARCH_LIMIT = 3;

/** 강종 기호 (SS275·SM355A·SPHC, 옛 기호 SS400·SM490A 포함) */
const GRADE = /\b(SPHC|SS\d{3}|SM\d{3}[A-D]?)\b/g;
/** KS 번호 (KS D 3503, KS E ISO 3082) */
const KS_NUMBER = /KS\s*[A-Z]\s*(?:ISO\s*)?\d{3,5}/g;
/** KS 문서에 자주 나오는 낱말. 질문에 있으면 그 낱말이 많이 나오는 절을 고른다 */
const KS_WORDS = ['인장강도', '항복강도', '연신율', '탄소당량', '샤르피', '충격', '화학성분', '성분', '허용차', '두께', '너비', '캠버', '굽힘', '밀시트', '합금철', '철광석', '석탄', '코크스', '석회석', '용선', '슬래브', '코일', '히트', '규격', '강종'];

const squeeze = (text: string) => text.toUpperCase().replace(/\s+/g, '');
const countOf = (haystack: string, needle: string) => (needle ? haystack.split(needle).length - 1 : 0);

/** 질문의 강종 기호·KS 번호·KS 낱말로 KS 규격 절을 고른다. 강종·번호는 낱말보다 무겁게 센다 */
export function searchKs(question: string, sections: readonly KsSection[] = KS_SECTIONS, limit: number = KS_SEARCH_LIMIT): KsSection[] {
  const asked = question.toUpperCase();
  const grades = [...new Set(asked.match(GRADE) ?? [])];
  const numbers = [...new Set((asked.match(KS_NUMBER) ?? []).map(squeeze))];
  const words = KS_WORDS.filter((word) => question.includes(word));
  if (grades.length + numbers.length + words.length === 0) return [];
  return sections
    .filter((section) => !KS_SKIP.has(section.id))
    .map((section, index) => {
      const body = `${section.title}\n${section.text}`;
      const upper = body.toUpperCase();
      const squeezed = squeeze(body);
      const title = section.title.toUpperCase();
      // 제목에 강종이 있는 절(강종별 기준값·SM355 등급별 차이)은 본문에서 지나가며 언급한 절보다 앞에 둔다. SM355A는 'SM355' 제목에도 맞는다
      const titled = grades.filter((grade) => title.includes(grade) || title.includes(grade.replace(/[A-D]$/, ''))).length;
      const score =
        8 * titled +
        grades.reduce((sum, grade) => sum + 4 * Math.min(3, countOf(upper, grade)), 0) +
        numbers.reduce((sum, number) => sum + 4 * Math.min(3, countOf(squeezed, number)), 0) +
        words.reduce((sum, word) => sum + Math.min(3, countOf(body, word)), 0);
      return { section, index, score };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((match) => match.section);
}
