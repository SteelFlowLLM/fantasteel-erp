// 업무·알림 API 응답 타입 (docs/backend/notification.md).
import type { PageResult } from './api';
import type { NotificationType, TaskStatus } from './codes';

/** 알림 한 건 (API-242). 늘 받는 사원 한 명의 행이다 (부서 알림은 부서원별 행으로 펼친다) */
export interface NotificationView {
  id: number;
  notificationType: NotificationType;
  notificationContent: string;
  /** ERP 화면 이동 경로 */
  linkPath: string | null;
  messageId: number | null;
  businessEventId: number | null;
  /** null = 안 읽음 */
  readAt: string | null;
  createdAt: string;
}

/** 내 알림 목록: 최신순 페이지와 안 읽은 알림 수(상단 배지) */
export interface NotificationPage extends PageResult<NotificationView> {
  unreadCount: number;
}

/** 모두 읽음 처리 결과 */
export interface NotificationReadAllResult {
  readCount: number;
}

/** 업무 목록 범위 (API-239 scope): 담당한 업무, 등록한 업무, 담당하거나 등록한 업무 */
export const TASK_SCOPES = ['mine', 'created', 'all'] as const;
export type TaskScope = (typeof TASK_SCOPES)[number];

/** 업무 한 건 (REQ-NTF-001) */
export interface TaskView {
  id: number;
  taskTitle: string;
  taskDescription: string | null;
  assigneeId: number;
  assigneeName: string;
  /** 등록자 (ERD task.creator_id, 2026-10-08) */
  creatorId: number;
  creatorName: string;
  /** YYYY-MM-DD */
  dueDate: string;
  taskStatus: TaskStatus;
  createdAt: string;
  updatedAt: string;
  /** 메신저 메시지에서 등록한 업무의 원본 메시지 (16번, 없으면 null) */
  messageId: number | null;
  /** 관련 화면 경로: 등록·수정 때 넣은 경로, 없고 메시지에서 등록했으면 `/messenger?room=&message=`, 둘 다 없으면 null */
  linkPath: string | null;
}
