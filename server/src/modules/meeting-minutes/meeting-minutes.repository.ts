import { Injectable } from '@nestjs/common';
import { ITEM_TYPE, MEETING_MINUTES_STATUS } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const listSelect = {
  id: true,
  meetingMinutesTitle: true,
  meetingDate: true,
  meetingMinutesStatus: true,
  creatorId: true,
  createdAt: true,
  creator: { select: { employeeName: true } },
  _count: { select: { attendees: true } },
} satisfies Prisma.MeetingMinutesSelect;

const detailSelect = {
  id: true,
  meetingMinutesTitle: true,
  meetingDate: true,
  meetingMinutesStatus: true,
  transcript: true,
  transcriptSegments: true,
  summary: true,
  analysisResult: true,
  failureReason: true,
  confirmedAt: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, employeeName: true } },
  attendees: {
    orderBy: { id: 'asc' },
    select: { employeeId: true, employee: { select: { employeeName: true, department: { select: { departmentName: true } }, role: { select: { roleCode: true } } } } },
  },
} satisfies Prisma.MeetingMinutesSelect;

export type MeetingMinutesListRow = Prisma.MeetingMinutesGetPayload<{ select: typeof listSelect }>;
export type MeetingMinutesDetailRow = Prisma.MeetingMinutesGetPayload<{ select: typeof detailSelect }>;

/** DB 접근만 둔다. 첫 인자는 항상 tx (컨벤션 6장) */
@Injectable()
export class MeetingMinutesRepository {
  /** 퇴사하지 않은 사원만. 없는 id는 결과에서 빠진다 */
  findActiveEmployeeIds(tx: Tx, ids: number[]) {
    return tx.employee.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  }

  createMeetingMinutes(tx: Tx, data: Prisma.MeetingMinutesUncheckedCreateInput) {
    return tx.meetingMinutes.create({ data, select: { id: true } });
  }

  createAttendees(tx: Tx, meetingMinutesId: number, employeeIds: number[]) {
    return tx.meetingAttendee.createMany({ data: employeeIds.map((employeeId) => ({ meetingMinutesId, employeeId })) });
  }

  findDetail(tx: Tx, id: number) {
    return tx.meetingMinutes.findUnique({ where: { id }, select: detailSelect });
  }

  count(tx: Tx, where: Prisma.MeetingMinutesWhereInput) {
    return tx.meetingMinutes.count({ where });
  }

  /** 회의일 최신순, 같은 날은 나중에 만든 것이 위 */
  findList(tx: Tx, where: Prisma.MeetingMinutesWhereInput, page: { skip: number; take: number }) {
    return tx.meetingMinutes.findMany({ where, select: listSelect, orderBy: [{ meetingDate: 'desc' }, { id: 'desc' }], ...page });
  }

  /** 아직 TRANSCRIBING인 행만 바꾼다. 그 사이 다른 상태가 됐으면 0건 */
  finishTranscription(tx: Tx, id: number, data: Prisma.MeetingMinutesUncheckedUpdateManyInput) {
    return tx.meetingMinutes.updateMany({ where: { id, meetingMinutesStatus: MEETING_MINUTES_STATUS.TRANSCRIBING }, data });
  }

  /** 서버가 꺼지면서 음성을 잃은 전사 중 행을 모두 실패로 */
  failAllTranscribing(tx: Tx, failureReason: string) {
    return tx.meetingMinutes.updateMany({
      where: { meetingMinutesStatus: MEETING_MINUTES_STATUS.TRANSCRIBING },
      data: { meetingMinutesStatus: MEETING_MINUTES_STATUS.FAILED, failureReason },
    });
  }

  /** AI 정리를 시작한다: 전사가 있고 정리할 수 있는 상태일 때만 ANALYZING으로. 아니면 0건 */
  startAnalysis(tx: Tx, id: number) {
    return tx.meetingMinutes.updateMany({
      where: {
        id,
        transcript: { not: null },
        meetingMinutesStatus: { in: [MEETING_MINUTES_STATUS.TRANSCRIBED, MEETING_MINUTES_STATUS.REVIEW, MEETING_MINUTES_STATUS.FAILED] },
      },
      data: { meetingMinutesStatus: MEETING_MINUTES_STATUS.ANALYZING, failureReason: null },
    });
  }

  /** 아직 ANALYZING인 행만 바꾼다 */
  finishAnalysis(tx: Tx, id: number, data: Prisma.MeetingMinutesUncheckedUpdateManyInput) {
    return tx.meetingMinutes.updateMany({ where: { id, meetingMinutesStatus: MEETING_MINUTES_STATUS.ANALYZING }, data });
  }

  /** 서버가 꺼지면서 중단된 분석 중 행을 모두 실패로 */
  failAllAnalyzing(tx: Tx, failureReason: string) {
    return tx.meetingMinutes.updateMany({
      where: { meetingMinutesStatus: MEETING_MINUTES_STATUS.ANALYZING },
      data: { meetingMinutesStatus: MEETING_MINUTES_STATUS.FAILED, failureReason },
    });
  }

  /** 원료 품목만. 구매요청 후보의 품목 매칭용 (읽기) */
  findRawMaterials(tx: Tx) {
    return tx.item.findMany({ where: { itemType: ITEM_TYPE.RAW_MATERIAL }, select: { id: true, itemName: true, itemCode: true }, orderBy: { id: 'asc' } });
  }

  /** 수주번호로 수주 id (읽기) */
  findSalesOrdersByNo(tx: Tx, salesOrderNos: string[]) {
    return tx.salesOrder.findMany({ where: { salesOrderNo: { in: salesOrderNos } }, select: { id: true, salesOrderNo: true } });
  }

  /** 원료 품목 id만 (후보 수정·확정 때 품목이 실제 원료인지 확인) */
  findRawMaterialIds(tx: Tx, ids: number[]) {
    return tx.item.findMany({
      where: { id: { in: ids }, itemType: ITEM_TYPE.RAW_MATERIAL },
      select: { id: true },
    });
  }

  /**
   * 검토 중(REVIEW)이고 내가 읽은 뒤 아무도 고치지 않았을 때만 분석 결과를 바꾼다. 아니면 0건.
   * 두 요청이 같은 JSON을 읽고 각자 덮어써 한쪽 수정이 사라지지 않게 updatedAt을 조건에 건다.
   */
  saveReviewEdit(tx: Tx, id: number, readUpdatedAt: Date, data: { analysisResult: Prisma.InputJsonObject; summary?: string }) {
    return tx.meetingMinutes.updateMany({
      where: {
        id,
        meetingMinutesStatus: MEETING_MINUTES_STATUS.REVIEW,
        updatedAt: readUpdatedAt,
      },
      data,
    });
  }

  /** REVIEW → CONFIRMED. 두 번 눌러도 한 번만 0건이 아니다 */
  confirm(tx: Tx, id: number, confirmedAt: Date) {
    return tx.meetingMinutes.updateMany({
      where: { id, meetingMinutesStatus: MEETING_MINUTES_STATUS.REVIEW },
      data: {
        meetingMinutesStatus: MEETING_MINUTES_STATUS.CONFIRMED,
        confirmedAt,
      },
    });
  }

  /** 확정 직후 각 후보가 만든 결과를 분석 결과에 적는다 */
  saveAnalysisResult(tx: Tx, id: number, analysisResult: Prisma.InputJsonObject) {
    return tx.meetingMinutes.update({
      where: { id },
      data: { analysisResult },
      select: { id: true },
    });
  }

  createScheduleEvent(tx: Tx, data: Omit<Prisma.ScheduleEventUncheckedCreateInput, 'attendees'>, attendeeIds: number[]) {
    return tx.scheduleEvent.create({
      data: {
        ...data,
        attendees: {
          create: attendeeIds.map((employeeId) => ({ employeeId })),
        },
      },
      select: { id: true },
    });
  }
}
