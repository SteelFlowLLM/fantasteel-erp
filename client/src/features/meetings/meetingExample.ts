// Voice2ERP 회의록 예시 내용 (P2 준비 중 화면 전용, 실제 데이터 아님).
// 근거: 요구사항 REQ-VOC-001~004, 업무 프로세스 BP-VOC-01·BP-ACT-01, 용어 사전 TRM-097~099, ERD meeting_minutes·meeting_attendee.
// 회의록 항목은 ERD(회의 날짜·제목·전체 기록·요약·작성·참석자)만 쓴다. 사람 이름은 시드 사원(seed-assumptions 1-4)이다.
// 원본 전사(STT 전체 기록)와 AI 요약을 나눠 둔다 (BP-VOC-01 구현 제안).
import {
  ROLE,
  STEEL_GRADE,
  formatBusinessNo,
  formatCoilLotNo,
  formatHeatLotNo,
  formatSlabLotNo,
  type RoleCode,
} from '@/codes';

export const EXAMPLE_NO = (() => {
  const heat = formatHeatLotNo('BOF1', '260929', 15);
  const slab = formatSlabLotNo(heat, 3);
  return {
    salesOrder: formatBusinessNo('SALES_ORDER', '2609', 14),
    productionPlan: formatBusinessNo('PRODUCTION_PLAN', '2610', 3),
    heat,
    slab,
    coil: formatCoilLotNo(slab),
  } as const;
})();

export interface MeetingAttendeeExample {
  employeeName: string;
  /** 역할 코드. 화면에는 ROLE_LABEL 표시명으로 보인다 */
  roleCode: RoleCode;
}

/** 참석자 (meeting_attendee). 작성자는 생산부 부서장 */
export const ATTENDEES: readonly MeetingAttendeeExample[] = [
  { employeeName: '강민석', roleCode: ROLE.PRODUCTION },
  { employeeName: '김도윤', roleCode: ROLE.SALES },
  { employeeName: '정다은', roleCode: ROLE.PURCHASE },
  { employeeName: '서민지', roleCode: ROLE.QUALITY },
  { employeeName: '권예진', roleCode: ROLE.LOGISTICS },
];

/** 선택한 회의록 (meeting_minutes, TRM-099 meetingMinutes) */
export const SELECTED_MEETING_MINUTES = {
  title: '주간 생산회의',
  meetingDate: '2026-10-01',
  time: '10:00',
  duration: '42분',
  createdEmployeeName: '강민석',
} as const;

export interface TranscriptLine {
  at: string;
  speaker: string;
  text: string;
  /** 구매 관련 항목이 나온 발언 */
  purchaseRelated?: boolean;
}

/** STT 전체 기록 (원본, 고치지 않음) */
export const TRANSCRIPT: readonly TranscriptLine[] = [
  { at: '00:12', speaker: '강민석', text: '이번 주 열연 라인 정기 점검이 10-02에 잡혀 있어서 생산 일정이 하루 밀려요.' },
  { at: '02:10', speaker: '강민석', text: `점검 때문에 코일 ${EXAMPLE_NO.coil} 출하가 늦어질 수 있어요.` },
  { at: '05:40', speaker: '김도윤', text: `${EXAMPLE_NO.salesOrder}은 고객사 가람중공업에서 납기를 꼭 지켜 달라고 했어요.` },
  { at: '09:03', speaker: '정다은', text: '철광석 재고를 보니 다음 생산계획 소요량이 부족해요. 1,200 t 정도 더 필요해요.', purchaseRelated: true },
  { at: '17:45', speaker: '서민지', text: `${EXAMPLE_NO.heat} 성분 검사는 합격이에요. 결과는 내일까지 공유할게요.` },
  { at: '25:30', speaker: '권예진', text: `출하 일정이 정해지면 바로 알려 주세요. ${STEEL_GRADE.SM355A} 코일도 같이 나가요.` },
  { at: '31:20', speaker: '김도윤', text: '가람중공업에는 제가 납기 안내를 드릴게요.' },
  { at: '38:02', speaker: '강민석', text: '점검 결과는 누가 정리해서 공유해 주세요.' },
];

/** AI 요약 (초안) */
export const SUMMARY: readonly string[] = [
  '열연 라인 정기 점검으로 10-02 생산 일정이 하루 밀려요.',
  `${EXAMPLE_NO.salesOrder} 납기는 유지하고, 생산계획 ${EXAMPLE_NO.productionPlan}의 히트를 먼저 편성해요.`,
  '철광석 재고가 부족해 추가 구매가 필요해요.',
];

/** 결정사항. 히트 편성은 생산계획 단계라 생산계획 번호로 쓴다 (BP-PRD-01). 히트 LOT 번호는 실적 뒤에 생기므로 검사 발언에만 나온다. */
export const DECISIONS: readonly { text: string; at: string }[] = [
  { text: `${EXAMPLE_NO.salesOrder} 납기 유지 · 생산계획 ${EXAMPLE_NO.productionPlan} 히트 우선 편성`, at: '05:40' },
  { text: '철광석 1,200 t 구매요청 초안 작성', at: '09:03' },
  { text: '점검 결과 정리·공유', at: '38:02' },
];

export interface ExtractedTask {
  key: string;
  /** 추출한 담당자. 모호하면 비움 */
  assigneeName: string | null;
  /** 업무로 등록하면 task.title이 된다 (ERD task.title) */
  title: string;
  /** 추출한 마감일 (MM-DD). 모호하면 비움 */
  dueDate: string | null;
  at: string;
}

/** AI가 뽑은 할 일. 담당자·마감일이 모호하면 확인 전 등록하지 않는다 (BP-VOC-01). */
export const EXTRACTED_TASKS: readonly ExtractedTask[] = [
  { key: 'reschedule', assigneeName: '강민석', title: '10-02 열연 일정 다시 편성', dueDate: '10-01', at: '00:12' },
  { key: 'share-result', assigneeName: '서민지', title: `${EXAMPLE_NO.heat} 성분 검사 결과 공유`, dueDate: '10-02', at: '17:45' },
  { key: 'notify-customer', assigneeName: '김도윤', title: '가람중공업에 납기 안내', dueDate: '10-02', at: '31:20' },
  { key: 'inspection-report', assigneeName: null, title: '열연 점검 결과 정리·공유', dueDate: null, at: '38:02' },
];

/** 담당자·마감일이 모두 있어야 등록할 수 있다 (BP-VOC-01 "모호하면 확인 전 등록하지 않는다") */
export const isTaskReady = (task: ExtractedTask): boolean => Boolean(task.assigneeName && task.dueDate);

/** 구매 관련 항목 → Message → ERP 구매요청 초안으로 보낸다 (REQ-VOC-004, BP-ACT-01 추출 스키마) */
export const PURCHASE_ITEM = {
  rawMaterial: '철광석',
  rawMaterialCode: 'ORE01',
  requiredTon: '1,200',
  desiredReceiptDate: '10-07',
  requesterName: '정다은',
  at: '09:03',
} as const;

/** 회의록 목록 한 줄. meeting_minutes에 상태 열이 없어 상태 배지는 두지 않는다 (ERD, reports/6 C-4). */
export interface MeetingMinutesListItem {
  key: string;
  title: string;
  meta: string;
  sub: string;
}

/** 회의록 목록 (날짜별) */
export const MEETING_MINUTES_LIST: readonly { day: string; items: readonly MeetingMinutesListItem[] }[] = [
  {
    day: '오늘 · 10-01 (목)',
    items: [{ key: 'weekly', title: '주간 생산회의', meta: '10:00 · 42분 · 5명', sub: '할 일 4 · 구매 관련 1' }],
  },
  {
    day: '09-30 (수)',
    items: [
      { key: 'quality', title: '품질 점검 회의', meta: '15:00 · 30분 · 4명', sub: '업무 2 · 구매요청 초안 1' },
      { key: 'delivery', title: '납기 협의', meta: '10:30 · 25분 · 3명', sub: '업무 2' },
    ],
  },
  {
    day: '09-29 (화)',
    items: [{ key: 'equipment', title: '설비 점검 공유', meta: '14:00 · 20분 · 3명', sub: '할 일 1' }],
  },
];
