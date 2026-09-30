// 셸(레일 배지·상단 드롭다운·검색)이 쓰는 조회. 서버 API가 확정되면 이 파일만 맞춘다.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import { dashboardApi, type SearchKind } from '@/api/dashboard';
import { messengerApi, type MessageView, type ReadStateView } from '@/api/messenger';
import { notificationApi, type NotificationEvent } from '@/api/notifications';
import { shipmentRequestApi } from '@/api/shipments';
import { approvalApi } from '@/api/purchasing';
import { invalidateTopics } from '@/api/queryClient';
import { applyMessageToRooms, applyReadState, chatKeys } from '@/features/collab/chatCache';
import { usePlansToConfirmCount } from '@/features/production/productionHooks';
import { usePendingInspectionCount } from '@/features/quality/qualityHooks';
import { useRealtimeEvent } from '@/hooks/useRealtime';
import { canView, useMe } from '@/stores/auth';
import { toast } from '@/stores/toast';

export interface RecentNotification { id: number; title: string; body: string | null; createdAt: string; isRead: boolean; linkPath: string | null }
export interface RecentChatRoom { id: number; name: string; lastMessage: string | null; lastMessageAt: string | null; unreadCount: number }
export interface SearchHit { kind: string; kindLabel: string; label: string; linkPath: string }

const RECENT_LIMIT = 8;
/** 소켓이 잠깐 끊겼을 때를 대비한 느린 주기 확인. 평소에는 소켓 이벤트로 바로 갱신된다. */
const BADGE_REFETCH_MS = 60_000;

/** 안 읽은 알림 수 (키 첫 요소 = 실시간 주제 'notifications') */
function useUnreadNotificationCount(): number | undefined {
  return useQuery({ queryKey: ['notifications', 'unread-count'], queryFn: notificationApi.unreadCount, refetchInterval: BADGE_REFETCH_MS, refetchOnWindowFocus: true }).data?.count;
}
/** 내 모든 채팅방의 안 읽은 메시지 수 (키 첫 요소 = 실시간 주제 'chat-rooms') */
function useUnreadChatCount(): number | undefined {
  return useQuery({ queryKey: chatKeys.unread, queryFn: messengerApi.unreadCount, refetchInterval: BADGE_REFETCH_MS, refetchOnWindowFocus: true }).data?.totalUnreadCount;
}

/** 내가 승인할 구매요청 수 (부서장이 아니면 0). 키 첫 요소 = 실시간 주제 'purchase-requisitions' */
function useApprovalCount(): number | undefined {
  return useQuery({ queryKey: ['purchase-requisitions', 'approvals'], queryFn: approvalApi.mine, refetchInterval: BADGE_REFETCH_MS, refetchOnWindowFocus: true }).data?.counts.purchaseRequisition;
}
/**
 * 그 상태의 출하요청 건수 (키 첫 요소 = 실시간 주제 'shipment-requests', 목록 화면과 같은 조회).
 * REQUESTED = 배정 대기, ALLOCATED = 배정이 끝나 출고 확정을 기다리는 요청. 볼 권한이 없으면 부르지 않는다.
 */
function useShipmentRequestCount(status: 'REQUESTED' | 'ALLOCATED'): number | undefined {
  const me = useMe();
  return useQuery({
    queryKey: ['shipment-requests', 'list', { status }],
    queryFn: () => shipmentRequestApi.list({ status }),
    enabled: canView(me, 'SHIPMENT_REQUEST', 'GOODS_ISSUE_CONFIRM'),
    refetchInterval: BADGE_REFETCH_MS,
    select: (rows) => rows.length,
  }).data;
}

/**
 * 레일·상단 배지 숫자. 키는 nav.ts의 badge 값.
 * 배지를 더하려면 숫자를 주는 훅을 하나 만들고 아래 sources에 `키: 훅()` 한 줄을 넣는다. 값이 아직 없으면(undefined) 키를 넣지 않는다.
 */
export function useNavBadges(): Record<string, number> {
  const sources: Record<string, number | undefined> = {
    notifications: useUnreadNotificationCount(),
    chat: useUnreadChatCount(),
    shipmentWaiting: useShipmentRequestCount('REQUESTED'),
    goodsIssueWaiting: useShipmentRequestCount('ALLOCATED'),
    plansToConfirm: usePlansToConfirmCount(),
    approvals: useApprovalCount(),
    inspectionsPending: usePendingInspectionCount(),
  };
  const badges: Record<string, number> = {};
  for (const [key, value] of Object.entries(sources)) if (value !== undefined) badges[key] = value;
  return badges;
}

export function useRecentNotifications(enabled: boolean): { items: RecentNotification[]; isLoading: boolean } {
  const q = useQuery({ queryKey: ['notifications', 'recent'], queryFn: () => notificationApi.list({ limit: RECENT_LIMIT }), enabled });
  return {
    items: (q.data?.items ?? []).map((n) => ({ id: n.id, title: n.title, body: n.body, createdAt: n.createdAt, isRead: n.isRead, linkPath: n.linkPath })),
    isLoading: q.isLoading,
  };
}

/** 최근 대화 순 방 목록의 앞부분. 메신저 화면과 같은 조회(캐시)를 쓴다. */
export function useRecentChatRooms(enabled: boolean): { items: RecentChatRoom[]; isLoading: boolean } {
  const q = useQuery({ queryKey: chatKeys.rooms, queryFn: messengerApi.rooms, enabled });
  return {
    items: (q.data ?? []).slice(0, RECENT_LIMIT).map((r) => ({
      id: r.id,
      name: r.displayName, // DIRECT는 서버가 상대 이름을 준다
      lastMessage: r.lastMessage ? (r.lastMessage.messageType === 'FILE' ? `파일 · ${r.lastMessage.preview}` : r.lastMessage.preview) : null,
      lastMessageAt: r.lastMessage?.createdAt ?? null,
      unreadCount: r.unreadCount,
    })),
    isLoading: q.isLoading,
  };
}

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_MIN_LENGTH = 2;
/** 검색 종류의 한국어 이름. 서버가 kindLabel을 주지만, 비어 있을 때를 대비해 둔다. */
const SEARCH_KIND_LABEL: Record<SearchKind, string> = {
  SALES_ORDER: '수주', LOT: 'LOT', PRODUCTION_PLAN: '생산계획', PURCHASE_REQUISITION: '구매요청', SHIPMENT_REQUEST: '출하요청', MILL_SHEET: '밀시트',
};

/** 통합 검색 (GET /search?q=). 입력이 멈추고 잠깐 뒤에, 2글자 이상일 때만 부른다. */
export function useGlobalSearch(q: string, enabled: boolean): { items: SearchHit[]; isLoading: boolean } {
  const term = q.trim();
  const [debounced, setDebounced] = useState(term);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(term), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [term]);
  const active = enabled && term.length >= SEARCH_MIN_LENGTH;
  const settled = debounced === term;
  const query = useQuery({ queryKey: ['search', debounced], queryFn: () => dashboardApi.search(debounced), enabled: active && settled });
  if (!active) return { items: [], isLoading: false };
  return {
    // 입력이 바뀌는 중에는 앞선 검색 결과를 보여주지 않는다 (Enter로 엉뚱한 곳에 가지 않게)
    items: settled ? (query.data ?? []).map((r) => ({ kind: r.kind, kindLabel: r.kindLabel || SEARCH_KIND_LABEL[r.kind] || r.kind, label: r.label, linkPath: r.linkPath })) : [],
    isLoading: !settled || query.isLoading,
  };
}

const TOAST_PREVIEW = 40;
const clip = (text: string) => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > TOAST_PREVIEW ? `${one.slice(0, TOAST_PREVIEW)}…` : one;
};

/** 실시간 이벤트(새 메시지·알림)에 반응해 배지를 갱신하고 토스트를 띄운다. */
export function useShellLive(): void {
  const me = useMe();
  const location = useLocation();
  // 지금 열려 있는 대화방 (/messenger?room=<id>)
  const openRoomId = location.pathname === '/messenger' ? Number(new URLSearchParams(location.search).get('room')) || null : null;
  const openRoomRef = useRef(openRoomId);
  openRoomRef.current = openRoomId;

  useRealtimeEvent<NotificationEvent>('notification', (n) => {
    invalidateTopics(['notifications']);
    // 멘션·업무방 알림은 같은 메시지가 'message' 이벤트로도 와서 아래에서 한 번만 알린다
    if (n.notificationType === 'MENTION' || n.notificationType === 'WORK_ROOM_MESSAGE') return;
    toast.info(n.title);
  });
  // 다른 창에서 읽음 처리했을 때
  useRealtimeEvent('notification-read', () => invalidateTopics(['notifications']));

  useRealtimeEvent<MessageView>('message', (m) => {
    applyMessageToRooms(m, me.employeeId);
    if (m.senderId === null || m.senderId === me.employeeId) return; // 시스템 메시지·내가 보낸 메시지
    if (m.chatRoomId === openRoomRef.current) return;
    const mentioned = m.mentionEmployeeIds.includes(me.employeeId);
    toast.info(`${m.senderName ?? '알 수 없음'}${mentioned ? '님이 멘션했어요' : ''}: ${clip(m.content)}`);
  });
  useRealtimeEvent<ReadStateView>('chat-read', (s) => applyReadState(s));
}
