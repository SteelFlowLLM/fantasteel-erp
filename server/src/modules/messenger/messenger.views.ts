import { calcWeightTon, CHAT_ROOM_TYPE, deriveSalesOrderStatus, MESSAGE_TYPE, type ChatRoomType, type MessageType, type SalesOrderItemStatus, type SalesOrderStatus } from '@fantasteel/shared';
import type { MessageLinkView } from './erp-reference.resolver';
import type { ChatRoomRow, MessageRow } from './messenger.repository';

export const chatRoomLinkPath = (chatRoomId: number) => `/messenger?room=${chatRoomId}`;
const PREVIEW_LENGTH = 80;

export interface MessageFileView {
  fileName: string;
  fileSize: number;
  mimeType: string;
  /** API 경로. 앞에 서버 주소를 붙이고 Authorization 헤더 또는 `?access_token=`으로 받는다. */
  downloadPath: string;
}

/** REST 응답과 소켓 `message` 이벤트가 같은 모양을 쓴다. */
export interface MessageView {
  id: number;
  chatRoomId: number;
  /** null = 시스템 메시지 */
  senderId: number | null;
  senderName: string | null;
  messageType: MessageType;
  content: string;
  mentionEmployeeIds: number[];
  file: MessageFileView | null;
  links: MessageLinkView[];
  createdAt: Date;
}

export interface ChatRoomMemberView {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  jobGrade: string;
  departmentId: number;
  departmentName: string;
  lastReadMessageId: number | null;
}

export interface SalesOrderSummaryItemView {
  salesOrderItemId: number;
  lineNo: number;
  specCode: string;
  itemType: string;
  steelGradeCode: string;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  orderedQty: number;
  shippedQty: number;
  /** 주문 매수 × 1매 이론중량 (계산값) */
  weightTon: string;
  salesOrderItemStatus: SalesOrderItemStatus;
}

/** 업무방 상단에 보여 주는 수주 요약 (REQ-MSG-001). */
export interface SalesOrderSummaryView {
  salesOrderId: number;
  salesOrderNo: string;
  customerName: string;
  /** YYYY-MM-DD */
  dueDate: string;
  salesOrderStatus: SalesOrderStatus;
  linkPath: string;
  items: SalesOrderSummaryItemView[];
}

export interface LastMessageView {
  id: number;
  senderId: number | null;
  senderName: string | null;
  messageType: MessageType;
  /** 목록에 보여 줄 한 줄 (파일이면 파일 이름) */
  preview: string;
  createdAt: Date;
}

export interface ChatRoomView {
  id: number;
  chatRoomType: ChatRoomType;
  chatRoomName: string | null;
  /** 목록에 보여 줄 이름: 1:1은 상대 이름, 이름 없는 그룹은 멤버 이름 나열 */
  displayName: string;
  salesOrderId: number | null;
  salesOrder: SalesOrderSummaryView | null;
  members: ChatRoomMemberView[];
  memberCount: number;
  lastMessage: LastMessageView | null;
  unreadCount: number;
  myLastReadMessageId: number | null;
  createdAt: Date;
}

export function previewOf(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  return oneLine.length > PREVIEW_LENGTH ? `${oneLine.slice(0, PREVIEW_LENGTH)}…` : oneLine;
}

export function toMessageView(row: MessageRow, links: MessageLinkView[]): MessageView {
  const hasFile = row.messageType === MESSAGE_TYPE.FILE && !!row.filePath;
  return {
    id: row.id,
    chatRoomId: row.chatRoomId,
    senderId: row.senderId,
    senderName: row.sender?.employeeName ?? null,
    messageType: row.messageType as MessageType,
    content: row.content,
    mentionEmployeeIds: row.mentionEmployeeIds,
    file: hasFile
      ? { fileName: row.fileName ?? '', fileSize: row.fileSize ?? 0, mimeType: row.mimeType ?? 'application/octet-stream', downloadPath: `/api/v1/messages/${row.id}/file` }
      : null,
    links,
    createdAt: row.createdAt,
  };
}

export function toLastMessageView(row: MessageRow): LastMessageView {
  return {
    id: row.id,
    senderId: row.senderId,
    senderName: row.sender?.employeeName ?? null,
    messageType: row.messageType as MessageType,
    preview: previewOf(row.messageType === MESSAGE_TYPE.FILE ? (row.fileName ?? row.content) : row.content),
    createdAt: row.createdAt,
  };
}

function toSalesOrderSummary(so: NonNullable<ChatRoomRow['salesOrder']>): SalesOrderSummaryView {
  return {
    salesOrderId: so.id,
    salesOrderNo: so.salesOrderNo,
    customerName: so.customer.customerName,
    dueDate: so.dueDate.toISOString().slice(0, 10),
    salesOrderStatus: deriveSalesOrderStatus(so.items.map((i) => i.salesOrderItemStatus as SalesOrderItemStatus)),
    linkPath: `/sales-orders/${so.id}`,
    items: so.items.map((i) => ({
      salesOrderItemId: i.id,
      lineNo: i.lineNo,
      specCode: i.productSpec.specCode,
      itemType: i.productSpec.item.itemType,
      steelGradeCode: i.productSpec.steelGrade.steelGradeCode,
      thicknessMm: i.productSpec.thicknessMm.toString(),
      widthMm: i.productSpec.widthMm.toString(),
      lengthMm: i.productSpec.lengthMm.toString(),
      orderedQty: i.orderedQty,
      shippedQty: i.shippedQty,
      weightTon: calcWeightTon(i.orderedQty, i.productSpec.theoreticalWeightTon.toFixed(3)),
      salesOrderItemStatus: i.salesOrderItemStatus as SalesOrderItemStatus,
    })),
  };
}

function displayNameOf(room: ChatRoomRow, myEmployeeId: number): string {
  if (room.chatRoomName) return room.chatRoomName;
  if (room.chatRoomType === CHAT_ROOM_TYPE.WORK && room.salesOrder) return `#${room.salesOrder.salesOrderNo}`;
  const others = room.members.filter((m) => m.employeeId !== myEmployeeId).map((m) => m.employee.employeeName);
  return others.length ? others.join(', ') : '대화 상대 없음';
}

export function toChatRoomView(room: ChatRoomRow, myEmployeeId: number, lastMessage: MessageRow | null, unreadCount: number): ChatRoomView {
  return {
    id: room.id,
    chatRoomType: room.chatRoomType as ChatRoomType,
    chatRoomName: room.chatRoomName,
    displayName: displayNameOf(room, myEmployeeId),
    salesOrderId: room.salesOrderId,
    salesOrder: room.salesOrder ? toSalesOrderSummary(room.salesOrder) : null,
    members: room.members.map((m) => ({
      employeeId: m.employeeId,
      employeeNo: m.employee.employeeNo,
      employeeName: m.employee.employeeName,
      jobGrade: m.employee.jobGrade,
      departmentId: m.employee.departmentId,
      departmentName: m.employee.department.departmentName,
      lastReadMessageId: m.lastReadMessageId,
    })),
    memberCount: room.members.length,
    lastMessage: lastMessage ? toLastMessageView(lastMessage) : null,
    unreadCount,
    myLastReadMessageId: room.members.find((m) => m.employeeId === myEmployeeId)?.lastReadMessageId ?? null,
    createdAt: room.createdAt,
  };
}
