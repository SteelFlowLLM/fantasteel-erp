import type { MeetingCandidate } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import type { UpdateMeetingCandidateDto } from './dto/meeting-minutes.dto';
import { ISSUE, normalizeDateTime, quantityOf, validDate } from './meeting-analysis.validator';

/** 이 요청이 참조하는 사원 id (담당자·참석자). 부르는 쪽이 DB에서 사용 중인 사원인지 확인한다 */
export function employeeIdsIn(dto: { assigneeId?: number; attendeeIds?: number[] }): number[] {
  return [...new Set([...(dto.assigneeId === undefined ? [] : [dto.assigneeId]), ...(dto.attendeeIds ?? [])])];
}

const without = (issues: string[], ...removed: string[]) => issues.filter((i) => !removed.includes(i));

const WRONG_KIND = (what: string, kind: string) => new AppException('COM-004', `${kind} 후보에는 ${what}을(를) 고칠 수 없어요`);
const KIND_LABEL = {
  TASK: '업무',
  EVENT: '일정',
  PURCHASE: '구매요청',
} as const;

/**
 * 후보에 사람이 고친 칸을 반영한다 (검증은 AI 분석과 같은 규칙: 날짜는 회의일부터 1년, 톤은 소수 3자리).
 * 사용자가 직접 정한 칸은 AI가 붙인 확인 사유가 풀리므로 그 칸의 issues를 지운다.
 * 사원·품목이 실제로 있는지는 DB가 필요해 부르는 쪽이 먼저 확인한다. decision은 여기서 다루지 않는다.
 */
export function applyCandidateEdit(candidate: MeetingCandidate, dto: UpdateMeetingCandidateDto, meetingDate: string, baseLabel = '회의일'): MeetingCandidate {
  const next: MeetingCandidate = {
    ...candidate,
    issues: [...candidate.issues],
    attendeeIds: [...candidate.attendeeIds],
    purchase: candidate.purchase ? { ...candidate.purchase } : null,
  };
  const kindLabel = KIND_LABEL[candidate.kind];

  if (dto.title !== undefined) {
    const title = dto.title.trim();
    if (!title) throw new AppException('COM-004', '제목을 입력해 주세요');
    // 구매요청 사유는 처음에 제목으로 채워지므로, 사유를 따로 고치지 않은 상태면 같이 따라간다
    if (next.purchase && next.purchase.requestReason === candidate.title) next.purchase.requestReason = title;
    next.title = title;
  }
  if (dto.description !== undefined) next.description = dto.description?.trim() || null;

  if (dto.assigneeId !== undefined) {
    if (candidate.kind !== 'TASK') throw WRONG_KIND('담당자', kindLabel);
    next.assigneeId = dto.assigneeId;
    next.issues = without(next.issues, ISSUE.assignee);
  }
  if (dto.dueDate !== undefined) {
    if (candidate.kind !== 'TASK') throw WRONG_KIND('마감일', kindLabel);
    const dueDate = validDate(dto.dueDate, meetingDate);
    if (dueDate === null) throw new AppException('COM-004', `마감일은 ${baseLabel}(${meetingDate})부터 1년 안의 날짜로 입력해 주세요`);
    next.dueDate = dueDate;
    next.issues = without(next.issues, ISSUE.dueDate, ISSUE.sameDay);
  }

  if (dto.startAt !== undefined || dto.endAt !== undefined || dto.attendeeIds !== undefined) {
    if (candidate.kind !== 'EVENT') throw WRONG_KIND('일정 시각·참석자', kindLabel);
  }
  if (dto.startAt !== undefined) {
    const startAt = normalizeDateTime(dto.startAt, meetingDate);
    if (startAt === null) throw new AppException('COM-004', `시작 시각은 ${baseLabel}(${meetingDate})부터 1년 안의 시각으로 입력해 주세요`);
    next.startAt = startAt;
    next.issues = without(next.issues, ISSUE.eventStart);
    // 끝 시각을 말하지 않아 1시간으로 가정한 일정은 시작을 옮기면 끝도 같이 옮긴다
    if (dto.endAt === undefined && (candidate.endAssumed || candidate.endAt === null)) {
      const shifted = new Date(Date.parse(startAt) + 3_600_000);
      next.endAt = normalizeDateTime(toSeoulLocal(shifted), meetingDate) ?? startAt;
      next.endAssumed = true;
      if (!next.issues.includes(ISSUE.eventEndAssumed)) next.issues.push(ISSUE.eventEndAssumed);
    }
  }
  if (dto.endAt !== undefined) {
    const endAt = normalizeDateTime(dto.endAt, meetingDate);
    if (endAt === null) throw new AppException('COM-004', `끝 시각은 ${baseLabel}(${meetingDate})부터 1년 안의 시각으로 입력해 주세요`);
    next.endAt = endAt;
    next.endAssumed = false;
    next.issues = without(next.issues, ISSUE.eventEndAssumed);
  }
  if (next.startAt !== null && next.endAt !== null && next.endAt <= next.startAt) throw new AppException('COM-004', '끝 시각은 시작 시각보다 뒤여야 해요');
  if (dto.attendeeIds !== undefined) {
    if (dto.attendeeIds.length === 0) throw new AppException('COM-004', '참석자를 1명 이상 골라 주세요');
    next.attendeeIds = [...new Set(dto.attendeeIds)];
    next.issues = without(next.issues, ISSUE.eventAttendees);
  }

  if (dto.purchase !== undefined) {
    if (candidate.kind !== 'PURCHASE' || next.purchase === null) throw WRONG_KIND('구매요청 칸', kindLabel);
    const p = dto.purchase;
    if (p.itemId !== undefined) {
      next.purchase.itemId = p.itemId;
      next.issues = without(next.issues, ISSUE.rawMaterial);
    }
    if (p.requestedTon !== undefined) {
      const text = p.requestedTon.trim();
      const ton = /^\d+(\.\d{1,3})?$/.test(text) ? quantityOf(text) : null;
      if (ton === null) throw new AppException('COM-004', '수량(톤)은 0보다 큰 숫자로, 소수 3자리까지 입력해 주세요');
      next.purchase.requestedTon = ton;
      next.issues = without(next.issues, ISSUE.quantityTon);
    }
    if (p.desiredReceiptDate !== undefined) {
      const date = validDate(p.desiredReceiptDate, meetingDate);
      if (date === null) throw new AppException('COM-004', `희망 입고일은 ${baseLabel}(${meetingDate})부터 1년 안의 날짜로 입력해 주세요`);
      next.purchase.desiredReceiptDate = date;
      next.issues = without(next.issues, ISSUE.desiredReceiptDate);
    }
  }
  return next;
}

/** Date를 서울 `YYYY-MM-DDTHH:mm`로 (끝 시각 가정 계산용) */
function toSeoulLocal(at: Date): string {
  return new Date(at.getTime() + 9 * 3_600_000).toISOString().slice(0, 16);
}
