// 과거 사례 (EX, REQ-CASE-001~005, BP-CASE-01, API-267~270, 용어 사전 TRM-108).
// 서버는 예시 사례(아래 PAST_CASE_EXAMPLES)와 등록 사례(ERD past_case·past_case_lot)를 합쳐 쓴다.
// 항목 이름은 ERD past_case 열을 따른다. 검색 규칙은 서버(검색 API·AI 도구)와 화면이 함께 쓴다.

import type { AuthUser } from './api';
import { CASE_CATEGORY, CASE_CATEGORY_LABEL, ROLE, type CaseCategory } from './codes';

/** 공통 코드 정의서 2장 CASE_CATEGORY (EX). 과거 사례 쪽 이름으로 다시 내보낸다 */
export const PAST_CASE_CATEGORY = CASE_CATEGORY;
export type PastCaseCategory = CaseCategory;
export const PAST_CASE_CATEGORY_LABEL = CASE_CATEGORY_LABEL;

/** 사례 번호 CASE-NNNN (ERD TBD, 가정값) */
export function formatCaseNo(seq: number): string {
  return `CASE-${String(seq).padStart(4, '0')}`;
}

export interface PastCaseLotView {
  /** 예시 사례의 LOT은 실제 LOT이 아니라 null */
  lotId: number | null;
  lotNo: string;
}

/** 과거 사례 (API-267 목록 줄 · API-268 상세) */
export interface PastCaseView {
  id: number;
  caseNo: string;
  caseCategory: PastCaseCategory;
  title: string;
  phenomenon: string;
  cause: string;
  actionTaken: string;
  /** 설비 마스터 없이 텍스트 (REQ-CASE-001) */
  equipmentText: string;
  lots: PastCaseLotView[];
  /** 발생일 YYYY-MM-DD */
  occurredDate: string;
  /** 예시 사례면 null */
  createdEmployeeName: string | null;
  /** 등록한 사원과 그 소속 부서 (수정·삭제 권한 판단용). 예시 사례면 null */
  createdEmployeeId: number | null;
  createdEmployeeDepartmentId: number | null;
  /** 등록 시각 (ISO). 예시 사례면 null */
  createdAt: string | null;
  /** 마지막 수정 시각 (ISO). 수정할 때 expectedUpdatedAt으로 돌려보내 동시 수정을 막는다. 예시 사례면 null */
  updatedAt: string | null;
  /** 화면 구성용 예시 사례 (실제 사례 아님) */
  isExample: boolean;
}

/** API-267 검색 조건 */
export interface PastCaseSearchInput {
  /** 검색어. 핵심어를 뽑아 찾는다 */
  q?: string;
  category?: PastCaseCategory;
  /** 최근 며칠 안에 생긴 사례만 (발생일 기준) */
  days?: number;
}

/** API-269 사례 초안: AI가 쓴 초안(실패하면 검사 결과로 채운 초안). 품질 담당이 고친 뒤 API-270으로 저장한다 */
export interface PastCaseDraftView {
  lot: { lotId: number; lotNo: string; lotType: string; steelGradeCode: string | null };
  caseCategory: PastCaseCategory;
  title: string;
  phenomenon: string;
  cause: string;
  actionTaken: string;
  equipmentText: string;
  occurredDate: string;
  /** AI가 썼으면 true. false면 aiNotice에 이유가 있다 */
  aiWritten: boolean;
  aiNotice: string | null;
  /** 초안을 쓸 때 참고한 비슷한 사례 번호 */
  referenceCaseNos: string[];
}

/** API-270 사례 등록 */
export interface CreatePastCaseInput {
  caseCategory: PastCaseCategory;
  title: string;
  phenomenon: string;
  cause: string;
  actionTaken: string;
  equipmentText: string;
  occurredDate: string;
  lotIds: number[];
}

// ── 검색 (REQ-CASE-003: 핵심어를 뽑아 한국어 부분 일치로 찾는다. ngram 전문검색 인덱스는 구현 시 정한다) ──

/** 질문마다 붙는 말이라 검색어로 쓰면 모든 사례에 걸리거나 아무것에도 안 걸린다 */
const STOP_WORDS = new Set(['과거', '사례', '비슷한', '찾아줘', '찾아', '알려줘', '요약해', '요약해줘', '관련', '원인', '조치', '현상']);
/**
 * 낱말 끝 조사 (세 글자 이상 낱말에서만 뗀다: '온도'·'히트' 같은 두 글자 낱말이 한 글자가 되지 않게).
 * '로'는 넣지 않는다: '가열로'·'전로'처럼 설비 이름이 '로'로 끝난다
 */
const JOSA = /(에서|으로|과|와|은|는|이|가|을|를|의|에)$/;

/** 검색어에서 핵심어를 뽑는다 (두 글자 이상, 중복·흔한 말 제외) */
export function caseKeywords(query: string): string[] {
  const words = query
    .split(/[\s,·'"“”‘’?!.]+/)
    .map((word) => (word.length > 2 ? word.replace(JOSA, '') : word))
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
  return [...new Set(words)];
}

function searchTextOf(item: PastCaseView): string {
  return [item.caseNo, PAST_CASE_CATEGORY_LABEL[item.caseCategory], item.title, item.phenomenon, item.cause, item.actionTaken, item.equipmentText, ...item.lots.map((lot) => lot.lotNo)]
    .join(' ')
    .toLowerCase();
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * 핵심어가 많이 맞는 사례 먼저, 같으면 최신순(발생일 → 사례 번호). 핵심어가 없으면 거르기만 하고 최신순.
 * 핵심어는 하나라도 맞으면 결과에 넣는다 ('SM355A 히트 불합격'에서 강종이 다른 불합격 사례도 비슷한 사례로 보인다).
 */
export function searchPastCases(cases: readonly PastCaseView[], search: PastCaseSearchInput, today: string): PastCaseView[] {
  const keywords = caseKeywords(search.q ?? '').map((word) => word.toLowerCase());
  const latestFirst = [...cases].sort((a, b) => b.occurredDate.localeCompare(a.occurredDate) || b.id - a.id);
  const scored = latestFirst
    .filter((item) => !search.category || item.caseCategory === search.category)
    .filter((item) => search.days === undefined || daysBetween(item.occurredDate, today) <= search.days)
    .map((item) => {
      const text = searchTextOf(item);
      return { item, score: keywords.filter((word) => text.includes(word)).length };
    });
  if (!keywords.length) return scored.map((row) => row.item);
  return scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.item);
}

// ── 예시 사례 (실제 사례 아님): 화면 구성과 시연용. REQ-CASE-005 시드 개수·작성 방식 TBD ──

const example = (seq: number, item: Omit<PastCaseView, 'id' | 'caseNo' | 'createdEmployeeName' | 'createdEmployeeId' | 'createdEmployeeDepartmentId' | 'createdAt' | 'updatedAt' | 'isExample' | 'lots'> & { lotNos: string[] }): PastCaseView => {
  const { lotNos, ...rest } = item;
  return { id: seq, caseNo: formatCaseNo(seq), ...rest, lots: lotNos.map((lotNo) => ({ lotId: null, lotNo })), createdEmployeeName: null, createdEmployeeId: null, createdEmployeeDepartmentId: null, createdAt: null, updatedAt: null, isExample: true };
};

/** 예시 사례 5건 (품질 2, 설비 3). 구분은 원인이 설비면 설비. 등록 사례 번호는 CASE-0006부터 */
export const PAST_CASE_EXAMPLES: readonly PastCaseView[] = [
  example(5, {
    caseCategory: 'QUALITY',
    title: 'SM355A 히트 성분 불합격 · 합금철 투입량 편차',
    phenomenon: '히트 성분 검사에서 망가니즈(Mn)가 1.68%로 기준(1.60% 이하)을 넘어 불합격이에요.',
    cause: '실리코망가니즈(SMN01) 투입량이 원단위보다 많이 들어갔어요.',
    actionTaken: '다음 히트부터 합금철 투입량을 원단위와 다시 맞춰 보고 기록해요.',
    equipmentText: '1번 전로',
    lotNos: ['HT-BOF1-260912-004'],
    occurredDate: '2026-09-12',
  }),
  example(4, {
    caseCategory: 'QUALITY',
    title: 'SPHC 코일 표면 스케일 결함',
    phenomenon: '코일 표면 검사에서 스케일 자국이 남아 불합격이에요.',
    cause: '열연 전 스케일 제거가 부족했어요.',
    actionTaken: '스케일 제거 설비의 압력을 점검하고 다음 코일부터 표면을 다시 확인해요.',
    equipmentText: '열연 스케일 제거 설비',
    lotNos: ['CBOF1-260825-011-02'],
    occurredDate: '2026-08-27',
  }),
  example(3, {
    caseCategory: 'EQUIPMENT',
    title: '1번 전로 온도 측정 오차로 성분 불합격',
    phenomenon: '출강 온도가 실제보다 낮게 측정돼 성분 조정이 어긋났어요.',
    cause: '온도 측정 프로브 교체 주기가 지났어요.',
    actionTaken: '프로브를 교체하고 교체 주기를 점검표에 넣었어요.',
    equipmentText: '1번 전로 온도 측정 프로브',
    lotNos: ['HT-BOF1-260803-007'],
    occurredDate: '2026-08-03',
  }),
  example(2, {
    caseCategory: 'EQUIPMENT',
    title: 'SS275 슬래브 표면 균열',
    phenomenon: '슬래브 표면에 가로 균열이 보여 불합격이에요.',
    cause: '2차 냉각대 노즐이 막혀 연주 냉각수 양이 고르지 않았어요.',
    actionTaken: '냉각수 노즐을 청소하고 냉각 조건을 다시 맞췄어요.',
    equipmentText: '연주기 2차 냉각대',
    lotNos: ['HT-BOF1-260719-009-05'],
    occurredDate: '2026-07-19',
  }),
  example(1, {
    caseCategory: 'EQUIPMENT',
    title: '열연 가열로 온도 편차로 코일 재질 불합격',
    phenomenon: '코일 인장 시험에서 항복강도가 기준에 못 미쳤어요.',
    cause: '가열로 구역별 온도 편차가 컸어요.',
    actionTaken: '가열로 버너를 조정하고 구역별 온도를 매 히트 확인해요.',
    equipmentText: '열연 가열로',
    lotNos: ['CBOF1-260630-012-03'],
    occurredDate: '2026-06-30',
  }),
];

/** 사례 수정 (등록과 같은 항목 전체를 다시 보낸다. 관련 LOT은 보낸 목록으로 바꾼다) */
export interface UpdatePastCaseInput extends CreatePastCaseInput {
  /** 사례를 불러왔을 때의 updatedAt. 그 사이 다른 사람이 고쳤으면 COM-001로 거절한다 */
  expectedUpdatedAt?: string | null;
}

/** 사례를 고치거나 지울 수 있는 사람: 등록한 사원 본인, 그 사원 소속 부서의 부서장, 관리자. 예시 사례는 아무도 못 한다 */
export function canModifyPastCase(user: Pick<AuthUser, 'employeeId' | 'roleCode' | 'headDepartmentIds'>, pastCase: Pick<PastCaseView, 'createdEmployeeId' | 'createdEmployeeDepartmentId'>): boolean {
  if (pastCase.createdEmployeeId === null) return false;
  if (user.roleCode === ROLE.ADMIN || user.employeeId === pastCase.createdEmployeeId) return true;
  return pastCase.createdEmployeeDepartmentId !== null && user.headDepartmentIds.includes(pastCase.createdEmployeeDepartmentId);
}

/** 과거 사례 검색어 최대 글자 수. 서버 DTO와 화면이 같은 값을 쓴다 (이슈 #498) */
export const PAST_CASE_QUERY_MAX = 200;
