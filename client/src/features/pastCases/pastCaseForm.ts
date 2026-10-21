// 사례 등록·수정 창이 같이 쓰는 입력값 (API-270 등록, 수정은 이슈 #464). 서버 DTO와 같은 항목이다.
import type { CreatePastCaseInput, PastCaseDraftView, PastCaseView } from '@fantasteel/shared';

export type PastCaseForm = Omit<CreatePastCaseInput, 'lotIds'>;

export const formOfDraft = (draft: PastCaseDraftView): PastCaseForm => ({
  caseCategory: draft.caseCategory,
  title: draft.title,
  phenomenon: draft.phenomenon,
  cause: draft.cause,
  actionTaken: draft.actionTaken,
  equipmentText: draft.equipmentText,
  occurredDate: draft.occurredDate,
});

export const formOfCase = (item: PastCaseView): PastCaseForm => ({
  caseCategory: item.caseCategory,
  title: item.title,
  phenomenon: item.phenomenon,
  cause: item.cause,
  actionTaken: item.actionTaken,
  equipmentText: item.equipmentText,
  occurredDate: item.occurredDate,
});

/** 비어 있으면 저장할 수 없는 항목 이름 (제목·현상·발생일) */
export const missingFieldsOf = (form: PastCaseForm): string[] => [!form.title.trim() && '제목', !form.phenomenon.trim() && '현상', !form.occurredDate && '발생일'].filter((name): name is string => typeof name === 'string');

/** 수정 창으로 보낼 관련 LOT id. 예시 사례의 LOT(lotId null)은 없다 */
export const lotIdsOf = (item: PastCaseView): number[] => item.lots.flatMap((lot) => (lot.lotId === null ? [] : [lot.lotId]));
