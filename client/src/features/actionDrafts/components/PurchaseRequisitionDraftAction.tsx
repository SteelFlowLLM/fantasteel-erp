'use client';

// 메시지 메뉴의 '구매요청 초안 만들기' (REQ-ACT-001, PLAN 6장 4번: 모든 채팅방 메시지에서 시작)
// - 이 메시지에 반려되지 않은 초안이 이미 있으면 '구매요청 초안 보기'로 그 초안을 연다 (중복 생성 방지, BP-ACT-01).
// - 만들기는 구매요청 등록 사용 권한이 있어야 한다. 요청자는 메시지 작성자다 (core).
import { useRouter } from 'next/navigation';
import { actionDraftApi } from '@/api/actionDrafts';
import { DRAFT_STATUS_LABEL, PERMISSION } from '@/codes';
import { MessageActionItem } from '@/features/messenger/components/MessageActionItem';
import type { MessageActionEntry, MessageActionProps } from '@/features/messenger/messageActions';
import { useAction } from '@/hooks/useAction';
import { useRoomActionDrafts } from '@/hooks/useActionDrafts';
import { useCanUse } from '@/hooks/usePermission';
import { withEulReul } from '@/lib/josa';
import { canView, permissionNeedText } from '@/lib/permissions';

const NEED = [PERMISSION.PURCHASE_REQUISITION_CREATE];

export function PurchaseRequisitionDraftAction({ message, room, closeMenu }: MessageActionProps) {
  const router = useRouter();
  const canCreate = useCanUse(PERMISSION.PURCHASE_REQUISITION_CREATE);
  const drafts = useRoomActionDrafts(room.id);
  const create = useAction(actionDraftApi.createFromMessage, {
    success: (result) => (result.created ? `${withEulReul(`구매요청 초안 #${result.id}`)} 만들었어요. 값을 입력하고 확정해 주세요` : `${withEulReul(`이미 만든 초안 #${result.id}`)} 열어요`),
    onSuccess: (result) => {
      closeMenu();
      router.push(`/action-drafts/${result.id}`);
    },
  });

  const existing = drafts.data?.find((draft) => draft.messageId === message.id && draft.draftStatus !== 'REJECTED');
  if (existing) {
    return (
      <MessageActionItem
        icon="file"
        aside={DRAFT_STATUS_LABEL[existing.draftStatus]}
        onClick={() => {
          closeMenu();
          router.push(`/action-drafts/${existing.id}`);
        }}
      >
        구매요청 초안 보기 #{existing.id}
      </MessageActionItem>
    );
  }
  return (
    <MessageActionItem
      icon="cart"
      disabled={!canCreate || drafts.isPending || create.isPending}
      title={canCreate ? undefined : permissionNeedText(NEED)}
      aside={canCreate ? undefined : '권한 필요'}
      onClick={() => create.mutate({ messageId: message.id })}
    >
      {create.isPending ? '초안을 만드는 중…' : '구매요청 초안 만들기'}
    </MessageActionItem>
  );
}

/** 메시지 메뉴 등록 항목 (features/messenger/messageActions.ts의 MESSAGE_ACTIONS에 넣는다) */
export const PURCHASE_REQUISITION_DRAFT_ACTION: MessageActionEntry = {
  key: 'purchase-requisition-draft',
  order: 10,
  // 사원이 보낸 글 메시지(시스템·첨부만 있는 메시지 제외)에서, 구매요청 조회 이상 권한이 있을 때 보인다
  isAvailable: (message, _room, me) => !message.isSystem && (message.content ?? '').trim() !== '' && canView(me, ...NEED),
  Component: PurchaseRequisitionDraftAction,
};
