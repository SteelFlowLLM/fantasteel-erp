// 메시지 메뉴의 동작 등록부 — Message → ERP(REQ-ACT-001 구매요청 초안 만들기)가 여기에 동작을 더한다 (3단계).
// 메시지 말풍선의 '더 보기' 메뉴는 이 목록을 그린다. 등록된 동작이 없거나 이 메시지에 쓸 수 있는 동작이 없으면 메뉴 버튼을 숨긴다.
//
// 더하는 법 (둘 중 하나):
// 1) 아래 MESSAGE_ACTIONS 배열에 한 줄을 넣는다.
//      { key: 'purchase-requisition-draft', sortOrder: 10, isAvailable: (message, room, me) => …, Component: PurchaseRequisitionDraftAction }
// 2) 다른 모듈에서 registerMessageAction({...})을 부른다 (그 모듈이 메신저 화면보다 먼저 불려야 한다).
// Component는 MessageActionItem(features/messenger/components/MessageActionItem.tsx)으로 메뉴 한 줄을 그리고,
// 안에서 훅(useAction·useRouter 등)을 자유롭게 쓴다. 일을 마치면 closeMenu()를 부른다.
import type { ComponentType } from 'react';
import type { ChatRoomDetailView, MessageView } from '@/api/messenger';
import type { SessionUser } from '@/api/session';
import { PURCHASE_REQUISITION_DRAFT_ACTION } from '@/features/actionDrafts/components/PurchaseRequisitionDraftAction';
import { DELETE_MESSAGE_ACTION, EDIT_MESSAGE_ACTION, PIN_MESSAGE_ACTION, REACTION_MESSAGE_ACTION, REPLY_MESSAGE_ACTION } from '@/features/messenger/components/MessageEditActions';

export interface MessageActionProps {
  message: MessageView;
  room: ChatRoomDetailView;
  /** 메뉴를 닫는다 */
  closeMenu: () => void;
}

export interface MessageActionEntry {
  /** 같은 key로 다시 등록하면 바꾼다 */
  key: string;
  /** 메뉴 표시 순서 (ERD sort_order와 같은 뜻). 작은 수가 위 (기본 100) */
  sortOrder?: number;
  /** 이 메시지에서 보일지 (권한·메시지 종류). 없으면 늘 보인다 */
  isAvailable?: (message: MessageView, room: ChatRoomDetailView, me: SessionUser) => boolean;
  Component: ComponentType<MessageActionProps>;
}

/** 코드로 넣는 동작 (3단계가 이 배열에 더한다) */
const MESSAGE_ACTIONS: MessageActionEntry[] = [REACTION_MESSAGE_ACTION, REPLY_MESSAGE_ACTION, EDIT_MESSAGE_ACTION, DELETE_MESSAGE_ACTION, PIN_MESSAGE_ACTION, PURCHASE_REQUISITION_DRAFT_ACTION];

const registered: MessageActionEntry[] = [];

export function registerMessageAction(entry: MessageActionEntry): void {
  const index = registered.findIndex((e) => e.key === entry.key);
  if (index >= 0) registered[index] = entry;
  else registered.push(entry);
}

/** 테스트에서 등록을 비울 때 */
export function clearRegisteredMessageActions(): void {
  registered.length = 0;
}

/** 이 메시지에 보일 동작 (sortOrder 순) */
export function messageActionsFor(message: MessageView, room: ChatRoomDetailView, me: SessionUser): MessageActionEntry[] {
  const byKey = new Map<string, MessageActionEntry>();
  for (const entry of [...MESSAGE_ACTIONS, ...registered]) byKey.set(entry.key, entry);
  return [...byKey.values()]
    .filter((entry) => !entry.isAvailable || entry.isAvailable(message, room, me))
    .sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100) || a.key.localeCompare(b.key));
}
