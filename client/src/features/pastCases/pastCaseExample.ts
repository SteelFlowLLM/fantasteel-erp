// 과거 사례 화면의 표시 규칙과 예시 작업 로그 (REQ-CASE-001~005·REQ-AST-006, BP-CASE-01, 용어 사전 TRM-108).
// 사례와 검색은 서버(API-267~270)가 준다: 예시 사례 5건(shared PAST_CASE_EXAMPLES, 실제 사례 아님)과 등록 사례(DB past_case).
// 사례 번호(case_no) 형식은 ERD에서 TBD라 'CASE-NNNN'을 쓴다 (가정값, docs/rework/areas/soon.md).
import type { PastCaseView } from '@fantasteel/shared';
import { BUSINESS_EVENT_TYPE, LOT_TYPE_LABEL, formatEventNo, type ActorType, type LotType } from '@/codes';
import type { ExampleBusinessEventType } from '@/features/agent/lib/businessEventLabel';

/** 같은 구분의 다른 사례 (고른 사례 제외) */
export function sameCategoryCases(target: PastCaseView, cases: readonly PastCaseView[]): PastCaseView[] {
  return cases.filter((item) => item.caseCategory === target.caseCategory && item.caseNo !== target.caseNo);
}

export interface CaseHistoryEntry {
  key: string;
  time: string;
  actorType: ActorType;
  businessEventType: ExampleBusinessEventType;
  eventNo: string;
  head: string;
  detail: string;
  /** AI 초안으로 확정한 작업 (TRM-103 AI 경유) */
  isAiAssisted?: boolean;
}

/** YYYY-MM-DD → MM-DD */
const monthDay = (date: string) => date.slice(5);
/** YYYY-MM-DD → YYMMDD (작업 로그 번호) */
const yymmdd = (date: string) => date.slice(2).replaceAll('-', '');

/** CASE-0005 예시 사례의 작업 로그 (REQ-LOG-002 이벤트만: 검사 등록·판정 → 불합격 처리 상태 지정 → 과거 사례 등록) */
export const SELECTED_CASE_HISTORY: readonly CaseHistoryEntry[] = [
  {
    key: 'inspection',
    time: '09-12 09:40',
    actorType: 'USER',
    businessEventType: BUSINESS_EVENT_TYPE.INSPECTION_REGISTERED,
    eventNo: formatEventNo('260912', 8),
    head: '히트 성분 검사 불합격',
    detail: '망가니즈(Mn) 1.68% · 기준 1.60% 이하',
  },
  {
    key: 'disposition',
    time: '09-12 10:05',
    actorType: 'USER',
    businessEventType: BUSINESS_EVENT_TYPE.DISPOSITION_SET,
    eventNo: formatEventNo('260912', 9),
    head: '처리 상태 보류 지정',
    detail: '불합격 LOT은 예약·배정·출고에서 빠져요',
  },
  {
    key: 'case',
    time: '09-13 09:00',
    actorType: 'USER',
    businessEventType: BUSINESS_EVENT_TYPE.CASE_REGISTERED,
    eventNo: formatEventNo('260913', 2),
    head: 'AI 초안을 품질 담당이 확인·저장',
    detail: 'CASE-0005 · 현상·원인·조치 기록',
    isAiAssisted: true,
  },
];

/**
 * 예시 사례의 작업 로그 (검사 불합격 → 처리 상태 지정 → 과거 사례 등록). CASE-0005는 위의 자세한 예시, 나머지는 사례 내용으로 만든다.
 * 등록 사례는 실제 작업 로그를 LOT 작업 로그 화면에서 본다(사례 등록 자체는 작업 로그 코드가 없어 남지 않는다).
 */
export function exampleHistoryOf(item: PastCaseView): readonly CaseHistoryEntry[] {
  if (item.caseNo === 'CASE-0005') return SELECTED_CASE_HISTORY;
  const day = monthDay(item.occurredDate);
  const ymd = yymmdd(item.occurredDate);
  return [
    { key: 'inspection', time: `${day} 09:00`, actorType: 'USER', businessEventType: BUSINESS_EVENT_TYPE.INSPECTION_REGISTERED, eventNo: formatEventNo(ymd, 3), head: '검사 불합격', detail: item.phenomenon },
    { key: 'disposition', time: `${day} 10:00`, actorType: 'USER', businessEventType: BUSINESS_EVENT_TYPE.DISPOSITION_SET, eventNo: formatEventNo(ymd, 4), head: '처리 상태 보류 지정', detail: '불합격 LOT은 예약·배정·출고에서 빠져요' },
    {
      key: 'case',
      time: `${day} 16:00`,
      actorType: 'USER',
      businessEventType: BUSINESS_EVENT_TYPE.CASE_REGISTERED,
      eventNo: formatEventNo(ymd, 5),
      head: 'AI 초안을 품질 담당이 확인·저장',
      detail: `${item.caseNo} · 현상·원인·조치 기록`,
      isAiAssisted: true,
    },
  ];
}

/** 사례가 쌓이는 순서 (BP-CASE-01 등록) */
export const CASE_REGISTER_STEPS: readonly string[] = ['불합격 판정', '처리 상태 지정', '사례로 등록 (AI 초안)', '품질 담당 확인·저장'];

/** 과거 사례를 찾는 곳 (REQ-CASE-004) */
export const CASE_CALL_SITES: readonly { key: string; place: string; how: string }[] = [
  { key: 'panel', place: '철강맨AI 패널', how: '모든 화면 오른쪽 패널에서 "비슷한 사례 찾아줘"처럼 물어요' },
  { key: 'chat', place: '사내 채팅 @AI', how: '메신저에서 @AI로 같은 AI를 불러 물어요' },
  { key: 'quality', place: '품질 관리 [비슷한 사례 찾기]', how: '검사 입력·불합격 관리의 더보기에서 누르면 이 화면이 열리고 검색어가 들어가요' },
];

/** AI 패널에 넣을 사례 질문 (REQ-CASE-004) */
export function similarCaseQuestion(lotNo: string, steelGradeCode: string): string {
  return `${steelGradeCode} ${lotNo} 불합격과 비슷한 과거 사례 찾아줘`;
}

/** 품질 화면 '비슷한 사례 찾기'가 이 화면에 넣을 검색어: 강종과 LOT 종류로 비슷한 불합격을 찾는다 */
export function similarCaseQuery(steelGradeCode: string | null, lotType: LotType): string {
  return [steelGradeCode, LOT_TYPE_LABEL[lotType], '불합격'].filter(Boolean).join(' ');
}

export function similarCaseHref(steelGradeCode: string | null, lotType: LotType): string {
  return `/past-cases?q=${encodeURIComponent(similarCaseQuery(steelGradeCode, lotType))}`;
}

/** 검색 결과 요약 칸이 AI에게 넣을 질문 (REQ-CASE-003 AI 요약) */
export function summaryQuestion(query: string): string {
  const q = query.trim();
  return q ? `"${q}"와 비슷한 과거 사례를 찾아 원인과 조치를 요약해 줘` : '최근 과거 사례를 찾아 원인과 조치를 요약해 줘';
}

/** 최근 기간 거르기 (일) */
export const CASE_PERIOD_DAYS = 90;
