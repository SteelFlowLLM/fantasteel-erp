import { Injectable } from '@nestjs/common';
import { ITEM_TYPE, LOT_TYPE, MEETING_MINUTES_STATUS, type MeetingMinutesStatus, PURCHASE_ORDER_STATUS, RESERVATION_STATUS, SALES_ORDER_ITEM_STATUS, TASK_STATUS } from '@fantasteel/shared';
import type { SalesOrderContextInput } from './meeting-candidate.context';
import { Prisma } from '../../generated/prisma/client';
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

/** 회의록 상세 (Notion 업무 공간 반영도 같은 모양으로 읽는다) */
export const meetingMinutesDetailSelect = {
  id: true,
  meetingMinutesTitle: true,
  meetingDate: true,
  meetingMinutesStatus: true,
  transcript: true,
  transcriptSegments: true,
  summary: true,
  analysisResult: true,
  analysisProgress: true,
  failureReason: true,
  confirmedAt: true,
  notionPageUrl: true,
  notionExportedAt: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, employeeName: true } },
  attendees: {
    orderBy: { id: 'asc' },
    select: { employeeId: true, employee: { select: { employeeName: true, department: { select: { departmentName: true } }, role: { select: { roleCode: true } } } } },
  },
} satisfies Prisma.MeetingMinutesSelect;

/** 철강맨AI 회의 검색용: 목록 칸에 요약과 AI 분석 결과(결정사항)를 더한다. 전사 글(수 MB)은 읽지 않는다 */
const digestSelect = { ...listSelect, summary: true, analysisResult: true } satisfies Prisma.MeetingMinutesSelect;
/** 한 회의를 자세히 볼 때(철강맨AI): 요약 칸에 참석자를 더한다. 이 칸도 전사 글은 읽지 않는다 */
const digestDetailSelect = {
  ...digestSelect,
  attendees: {
    orderBy: { id: 'asc' },
    select: { employeeId: true, employee: { select: { employeeName: true, department: { select: { departmentName: true } }, role: { select: { roleCode: true } } } } },
  },
} satisfies Prisma.MeetingMinutesSelect;

export type MeetingMinutesListRow = Prisma.MeetingMinutesGetPayload<{ select: typeof listSelect }>;
export type MeetingMinutesDigestRow = Prisma.MeetingMinutesGetPayload<{ select: typeof digestSelect }>;
export type MeetingMinutesDigestDetailRow = Prisma.MeetingMinutesGetPayload<{ select: typeof digestDetailSelect }>;
export type MeetingMinutesDetailRow = Prisma.MeetingMinutesGetPayload<{ select: typeof meetingMinutesDetailSelect }>;

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
    return tx.meetingMinutes.findUnique({ where: { id }, select: meetingMinutesDetailSelect });
  }

  count(tx: Tx, where: Prisma.MeetingMinutesWhereInput) {
    return tx.meetingMinutes.count({ where });
  }

  /** 회의일 최신순, 같은 날은 나중에 만든 것이 위 */
  findList(tx: Tx, where: Prisma.MeetingMinutesWhereInput, page: { skip: number; take: number }) {
    return tx.meetingMinutes.findMany({ where, select: listSelect, orderBy: [{ meetingDate: 'desc' }, { id: 'desc' }], ...page });
  }

  /** 철강맨AI 회의 검색: 회의일 최신순으로 요약·결정사항 칸까지 읽는다 */
  findDigests(tx: Tx, where: Prisma.MeetingMinutesWhereInput, page: { skip: number; take: number }) {
    return tx.meetingMinutes.findMany({ where, select: digestSelect, orderBy: [{ meetingDate: 'desc' }, { id: 'desc' }], ...page });
  }

  findDigestDetail(tx: Tx, id: number) {
    return tx.meetingMinutes.findUnique({ where: { id }, select: digestDetailSelect });
  }

  /** 아직 TRANSCRIBING인 행만 바꾼다. 그 사이 다른 상태가 됐으면 0건 */
  finishTranscription(tx: Tx, id: number, data: Prisma.MeetingMinutesUncheckedUpdateManyInput) {
    return tx.meetingMinutes.updateMany({ where: { id, meetingMinutesStatus: MEETING_MINUTES_STATUS.TRANSCRIBING }, data });
  }

  /** AI 정리를 시작한다: 전사가 있고 정리할 수 있는 상태일 때만 ANALYZING으로. 아니면 0건 */
  startAnalysis(tx: Tx, id: number) {
    return tx.meetingMinutes.updateMany({
      where: {
        id,
        transcript: { not: null },
        meetingMinutesStatus: { in: [MEETING_MINUTES_STATUS.TRANSCRIBED, MEETING_MINUTES_STATUS.REVIEW, MEETING_MINUTES_STATUS.FAILED] },
      },
      data: { meetingMinutesStatus: MEETING_MINUTES_STATUS.ANALYZING, failureReason: null, analysisProgress: Prisma.DbNull },
    });
  }

  /** 분석 진행 상황 (아직 ANALYZING인 행만). updated_at도 바뀌어 살아 있다는 표시를 겸한다 */
  setAnalysisProgress(tx: Tx, id: number, progress: Prisma.InputJsonObject) {
    return tx.meetingMinutes.updateMany({ where: { id, meetingMinutesStatus: MEETING_MINUTES_STATUS.ANALYZING }, data: { analysisProgress: progress } });
  }

  /** 아직 ANALYZING인 행만 바꾼다 */
  finishAnalysis(tx: Tx, id: number, data: Prisma.MeetingMinutesUncheckedUpdateManyInput) {
    return tx.meetingMinutes.updateMany({ where: { id, meetingMinutesStatus: MEETING_MINUTES_STATUS.ANALYZING }, data });
  }

  /** 이 서버가 맡은 전사·분석 행에 살아 있다는 표시를 남긴다 (updated_at만). 그 사이 다른 상태가 된 행은 건드리지 않는다 */
  touchInProgress(tx: Tx, ids: number[], status: MeetingMinutesStatus) {
    return tx.meetingMinutes.updateMany({ where: { id: { in: ids }, meetingMinutesStatus: status }, data: { updatedAt: new Date() } });
  }

  /** 맡은 서버가 멈춰 표시가 끊긴 전사·분석 행을 실패로. 마지막 표시가 staleBefore보다 오래된 행만, 이 서버가 맡은 행은 빼고 */
  failStale(tx: Tx, status: MeetingMinutesStatus, staleBefore: Date, exceptIds: number[], failureReason: string) {
    return tx.meetingMinutes.updateMany({
      where: { meetingMinutesStatus: status, updatedAt: { lt: staleBefore }, ...(exceptIds.length > 0 ? { id: { notIn: exceptIds } } : {}) },
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

  /** 후보 옆 현황용(읽기): 수주 고객사와 품목별 납기·수주 매수·출하(CONVERTED 예약) 매수. 없으면 null */
  async findSalesOrderContext(tx: Tx, salesOrderId: number): Promise<SalesOrderContextInput | null> {
    const order = await tx.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: {
        customer: { select: { customerName: true } },
        salesOrderItems: {
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
          select: {
            orderedQty: true,
            dueDate: true,
            salesOrderItemStatus: true,
            item: { select: { itemName: true } },
            reservations: { where: { reservationStatus: RESERVATION_STATUS.CONVERTED }, select: { reservedQty: true } },
          },
        },
      },
    });
    if (!order) return null;
    return {
      customerName: order.customer.customerName,
      items: order.salesOrderItems
        .filter((i) => i.salesOrderItemStatus !== SALES_ORDER_ITEM_STATUS.CANCELLED)
        .map((i) => ({
          itemName: i.item.itemName,
          orderedQty: i.orderedQty,
          shippedQty: i.reservations.reduce((sum, r) => sum + r.reservedQty, 0),
          dueDate: i.dueDate.toISOString().slice(0, 10),
          open: i.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.OPEN || i.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED,
        })),
    };
  }

  /** 원료 재고 톤: 그 품목 LOT 잔량 합계 (읽기, 소수 3자리 문자열) */
  async sumRawMaterialOnHandTon(tx: Tx, itemId: number): Promise<string> {
    const sum = await tx.lot.aggregate({ where: { lotType: LOT_TYPE.RAW_MATERIAL, itemId, remainingTon: { gt: 0 } }, _sum: { remainingTon: true } });
    return (sum._sum.remainingTon ?? new Prisma.Decimal(0)).toFixed(3);
  }

  /** 아직 입고가 끝나지 않은 발주의 품목 행: 발주 톤과 입고 톤들 (읽기) */
  async findOpenPurchaseOrderItems(tx: Tx, itemId: number): Promise<{ orderedTon: string; receivedTons: string[] }[]> {
    const rows = await tx.purchaseOrderItem.findMany({
      where: { itemId, purchaseOrder: { purchaseOrderStatus: { in: [PURCHASE_ORDER_STATUS.CONFIRMED, PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED] } } },
      select: { orderedTon: true, goodsReceipts: { select: { receivedTon: true } } },
    });
    return rows.map((r) => ({ orderedTon: r.orderedTon.toFixed(3), receivedTons: r.goodsReceipts.map((g) => g.receivedTon.toFixed(3)) }));
  }

  /** 담당자의 진행 중(OPEN) 업무 마감일들 (읽기) */
  async findOpenTaskDueDates(tx: Tx, assigneeId: number): Promise<string[]> {
    const rows = await tx.task.findMany({ where: { assigneeId, taskStatus: TASK_STATUS.OPEN }, select: { dueDate: true } });
    return rows.map((r) => r.dueDate.toISOString().slice(0, 10));
  }

  /** 그 시간대와 겹치는 일정 중 참석자가 한 명이라도 있는 것 (읽기). 맞닿기만 한 일정은 겹치지 않는다 */
  findOverlappingEvents(tx: Tx, employeeIds: number[], startAt: Date, endAt: Date) {
    return tx.scheduleEvent.findMany({
      where: { startAt: { lt: endAt }, endAt: { gt: startAt }, attendees: { some: { employeeId: { in: employeeIds } } } },
      orderBy: { startAt: 'asc' },
      select: { scheduleEventTitle: true, startAt: true, endAt: true, attendees: { select: { employeeId: true, employee: { select: { employeeName: true } } } } },
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

  /**
   * 화자 연결: 확정 전이고 전사가 있는 상태에서, 내가 읽은 뒤 아무도 고치지 않았을 때만 구간을 바꾼다. 아니면 0건.
   * 전사 중(TRANSCRIBING)·분석 중(ANALYZING)에는 결과가 덮어써지므로 허용하지 않는다.
   */
  saveSegments(tx: Tx, id: number, readUpdatedAt: Date, transcriptSegments: Prisma.InputJsonArray) {
    return tx.meetingMinutes.updateMany({
      where: {
        id,
        updatedAt: readUpdatedAt,
        transcript: { not: null },
        meetingMinutesStatus: { in: [MEETING_MINUTES_STATUS.TRANSCRIBED, MEETING_MINUTES_STATUS.REVIEW, MEETING_MINUTES_STATUS.FAILED] },
      },
      data: { transcriptSegments },
    });
  }

  /**
   * 참석자 고치기의 첫 단계: 확정 전이고 내가 읽은 뒤 아무도 고치지 않았을 때만 구간(빠진 참석자의 화자 연결을 푼 것)을 저장한다. 아니면 0건.
   * 참석자 행은 따로 있어도 이 갱신이 updated_at을 올려 동시에 고친 쪽을 막는다.
   */
  saveForAttendeeEdit(tx: Tx, id: number, readUpdatedAt: Date, statuses: readonly string[], transcriptSegments: Prisma.InputJsonArray | undefined) {
    return tx.meetingMinutes.updateMany({ where: { id, updatedAt: readUpdatedAt, meetingMinutesStatus: { in: [...statuses] } }, data: { transcriptSegments, updatedAt: new Date() } });
  }

  deleteAttendeesExcept(tx: Tx, meetingMinutesId: number, keepEmployeeIds: number[]) {
    return tx.meetingAttendee.deleteMany({ where: { meetingMinutesId, employeeId: { notIn: keepEmployeeIds } } });
  }

  /** 회의록 지우기: 참석자 행부터 지운다 (FK가 Restrict) */
  deleteAllAttendees(tx: Tx, meetingMinutesId: number) {
    return tx.meetingAttendee.deleteMany({ where: { meetingMinutesId } });
  }

  /** 회의록 지우기: 사원들이 이 회의에 물은 대화를 메시지부터 지운다 (FK가 Restrict) */
  async deleteChatThreads(tx: Tx, meetingMinutesId: number): Promise<void> {
    await tx.aiChatMessage.deleteMany({ where: { thread: { meetingMinutesId } } });
    await tx.aiChatThread.deleteMany({ where: { meetingMinutesId } });
  }

  /** 지울 수 있는 상태일 때만 지운다. 그 사이 분석을 시작했거나 확정했으면 0건 */
  deleteMeetingMinutes(tx: Tx, id: number, statuses: readonly string[]) {
    return tx.meetingMinutes.deleteMany({ where: { id, meetingMinutesStatus: { in: [...statuses] } } });
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

  /**
   * Notion 내보내기를 잡는다: 확정됐고 아직 내보내지 않았으며 아무도 내보내는 중이 아닐 때만 notion_exported_at에 시각을 적는다. 아니면 0건.
   * 두 사람이 동시에 눌러 Notion 페이지가 두 개 생기지 않게 한다. 내보내던 서버가 멈춘 잡기(staleBefore보다 오래됨)는 다시 잡을 수 있다.
   */
  claimNotionExport(tx: Tx, id: number, claimedAt: Date, staleBefore: Date) {
    return tx.meetingMinutes.updateMany({
      where: {
        id,
        meetingMinutesStatus: MEETING_MINUTES_STATUS.CONFIRMED,
        notionPageUrl: null,
        OR: [{ notionExportedAt: null }, { notionExportedAt: { lt: staleBefore } }],
      },
      data: { notionExportedAt: claimedAt },
    });
  }

  /** 내가 잡은 내보내기만 끝낸다 */
  finishNotionExport(tx: Tx, id: number, claimedAt: Date, notionPageUrl: string, exportedAt: Date) {
    return tx.meetingMinutes.updateMany({ where: { id, notionPageUrl: null, notionExportedAt: claimedAt }, data: { notionPageUrl, notionExportedAt: exportedAt } });
  }

  /** 내보내기가 실패하면 잡은 것을 푼다 */
  releaseNotionExport(tx: Tx, id: number, claimedAt: Date) {
    return tx.meetingMinutes.updateMany({ where: { id, notionPageUrl: null, notionExportedAt: claimedAt }, data: { notionExportedAt: null } });
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
