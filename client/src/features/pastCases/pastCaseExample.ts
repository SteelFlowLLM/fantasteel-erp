// 과거 사례 검색 예시 내용 (EX 준비 중 화면 전용, 실제 사례 아님).
// 근거: 요구사항 REQ-CASE-001~005·REQ-AST-006, 업무 프로세스 BP-CASE-01, 용어 사전 TRM-108, ERD past_case·past_case_lot.
// 항목 이름은 ERD past_case 열(caseNo·caseCategory·title·phenomenon·cause·actionTaken·equipmentText·occurredDate)을 따른다.
// 사례 번호(case_no) 형식은 ERD에서 TBD라 'CASE-NNNN'을 예시 표기로만 쓴다 (가정값, docs/rework/areas/soon.md).
import {
  BUSINESS_EVENT_TYPE,
  CASE_CATEGORY,
  PROPOSED_BUSINESS_EVENT_TYPE,
  STEEL_GRADE,
  formatCoilNo,
  formatEventNo,
  formatHeatNo,
  formatSlabNo,
  type ActorType,
  type CaseCategory,
} from '@/codes';
import type { ExampleBusinessEventType } from '@/features/agent/lib/businessEventLabel';

export interface PastCaseExample {
  caseNo: string;
  caseCategory: CaseCategory;
  title: string;
  phenomenon: string;
  cause: string;
  actionTaken: string;
  equipmentText: string;
  /** 관련 LOT (past_case_lot) */
  lotNos: readonly string[];
  /** 표시용 MM-DD */
  occurredDate: string;
}

const heatOf = (yymmdd: string, seq: number) => formatHeatNo('BOF1', yymmdd, seq);
const slabOf = (yymmdd: string, heatSeq: number, slabSeq: number) => formatSlabNo(heatOf(yymmdd, heatSeq), slabSeq);

/** 검색 결과 예시 5건 (최신순). 품질 3건, 설비 2건. */
export const PAST_CASES: readonly PastCaseExample[] = [
  {
    caseNo: 'CASE-0005',
    caseCategory: CASE_CATEGORY.QUALITY,
    title: `${STEEL_GRADE.SM355A} 히트 성분 불합격 · 합금철 투입량 편차`,
    phenomenon: '히트 성분 검사에서 망가니즈(Mn)가 1.68%로 기준(1.60% 이하)을 넘어 불합격이에요.',
    cause: '실리코망가니즈(SMN01) 투입량이 원단위보다 많이 들어갔어요.',
    actionTaken: '다음 히트부터 합금철 투입량을 원단위와 다시 맞춰 보고 기록해요.',
    equipmentText: '1번 전로',
    lotNos: [heatOf('260912', 4)],
    occurredDate: '09-12',
  },
  {
    caseNo: 'CASE-0004',
    caseCategory: CASE_CATEGORY.QUALITY,
    title: `${STEEL_GRADE.SPHC} 코일 표면 스케일 결함`,
    phenomenon: '코일 표면 검사에서 스케일 자국이 남아 불합격이에요.',
    cause: '열연 전 스케일 제거가 부족했어요.',
    actionTaken: '스케일 제거 설비의 압력을 점검하고 다음 코일부터 표면을 다시 확인해요.',
    equipmentText: '열연 스케일 제거 설비',
    lotNos: [formatCoilNo(slabOf('260825', 11, 2))],
    occurredDate: '08-27',
  },
  {
    caseNo: 'CASE-0003',
    caseCategory: CASE_CATEGORY.EQUIPMENT,
    title: '1번 전로 온도 측정 오차로 성분 불합격',
    phenomenon: '출강 온도가 실제보다 낮게 측정돼 성분 조정이 어긋났어요.',
    cause: '온도 측정 프로브 교체 주기가 지났어요.',
    actionTaken: '프로브를 교체하고 교체 주기를 점검표에 넣었어요.',
    equipmentText: '1번 전로 온도 측정 프로브',
    lotNos: [heatOf('260803', 7)],
    occurredDate: '08-03',
  },
  {
    caseNo: 'CASE-0002',
    caseCategory: CASE_CATEGORY.QUALITY,
    title: `${STEEL_GRADE.SS275} 슬래브 표면 균열`,
    phenomenon: '슬래브 표면에 가로 균열이 보여 불합격이에요.',
    cause: '연주 냉각수 양이 고르지 않았어요.',
    actionTaken: '냉각수 노즐을 청소하고 냉각 조건을 다시 맞췄어요.',
    equipmentText: '연주기 2차 냉각대',
    lotNos: [slabOf('260719', 9, 5)],
    occurredDate: '07-19',
  },
  {
    caseNo: 'CASE-0001',
    caseCategory: CASE_CATEGORY.EQUIPMENT,
    title: '열연 가열로 온도 편차로 코일 재질 불합격',
    phenomenon: '코일 인장 시험에서 항복강도가 기준에 못 미쳤어요.',
    cause: '가열로 구역별 온도 편차가 컸어요.',
    actionTaken: '가열로 버너를 조정하고 구역별 온도를 매 히트 확인해요.',
    equipmentText: '열연 가열로',
    lotNos: [formatCoilNo(slabOf('260630', 12, 3))],
    occurredDate: '06-30',
  },
];

export const SELECTED_CASE: PastCaseExample = PAST_CASES[0] as PastCaseExample;

/** 같은 구분의 다른 사례 (선택한 사례 제외) */
export function sameCategoryCases(target: PastCaseExample, cases: readonly PastCaseExample[] = PAST_CASES): PastCaseExample[] {
  return cases.filter((item) => item.caseCategory === target.caseCategory && item.caseNo !== target.caseNo);
}

/** 검색 예시 질문 */
export const EXAMPLE_QUERY = '성분 불합격 원인';

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

/** 선택한 사례의 작업 로그 (REQ-LOG-002 이벤트만: 검사 등록·판정 → 불합격 처리 상태 지정 → 과거 사례 등록) */
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
    businessEventType: PROPOSED_BUSINESS_EVENT_TYPE.CASE_REGISTERED,
    eventNo: formatEventNo('260913', 2),
    head: 'AI 초안을 품질 담당이 확인·저장',
    detail: `${SELECTED_CASE.caseNo} · 현상·원인·조치 기록`,
    isAiAssisted: true,
  },
];

/** 사례가 쌓이는 순서 (BP-CASE-01 등록) */
export const CASE_REGISTER_STEPS: readonly string[] = ['불합격 판정', '처리 상태 지정', '사례로 등록 (AI 초안)', '품질 담당 확인·저장'];

/** 과거 사례를 찾는 곳 (REQ-CASE-004) */
export const CASE_CALL_SITES: readonly { key: string; place: string; how: string }[] = [
  { key: 'panel', place: 'AI 어시스턴트 패널', how: '모든 화면 오른쪽 패널에서 질문해요' },
  { key: 'chat', place: '사내 채팅 @AI', how: '메신저에서 @AI로 같은 AI를 불러요' },
  { key: 'quality', place: '품질 관리 [비슷한 사례 찾기]', how: '불합격 관리에서 누르면 AI 패널이 열리고 질문이 자동으로 들어가요' },
];

/** '비슷한 사례 찾기'가 AI 패널에 자동으로 넣을 질문 (REQ-CASE-004) */
export function similarCaseQuestion(lotNo: string, steelGradeCode: string): string {
  return `${steelGradeCode} ${lotNo} 불합격과 비슷한 과거 사례 찾아줘`;
}
