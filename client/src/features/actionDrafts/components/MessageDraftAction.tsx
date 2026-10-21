'use client';

// 메시지 메뉴의 '○○ 초안 만들기' (REQ-ACT-001·005, BP-ACT-01·02, message-action.md 10장)
// - 유형은 사람이 메뉴에서 고른다. 확장 유형은 확정할 수 있는 유형(그 업무의 사용 권한)만 보인다. AI는 고른 유형의 칸만 채운다.
// - 구매요청은 확정 주체가 메시지 작성자라 방 멤버면 보이고, 작성자가 확정할 수 없으면 서버가 COM-002로 알린다.
// - 이 메시지·유형에 미처리 초안이 있으면 '초안 보기'로 그 초안을 연다. 다른 사원이 만든 초안이면 그 이름을 보인다.
import { useRouter } from 'next/navigation';
import { ACTION_TYPE, DRAFT_STATUS_LABEL, type ActionType } from '@/codes';
import { actionDraftApi } from '@/api/actionDrafts';
import type { IconName } from '@/components/Icon';
import { ACTION_TYPE_GUIDE, draftCreatedNotice, openDraftOf } from '@/features/actionDrafts/lib/typedDrafts';
import { MessageActionItem } from '@/features/messenger/components/MessageActionItem';
import type { MessageActionEntry, MessageActionProps } from '@/features/messenger/messageActions';
import { useAction } from '@/hooks/useAction';
import { useRoomActionDrafts } from '@/hooks/useActionDrafts';
import { useMe } from '@/hooks/useMe';
import { canUse } from '@/lib/permissions';
import { toast } from '@/stores/useToastStore';

function MessageDraftAction({ actionType, icon, message, room, closeMenu }: MessageActionProps & { actionType: ActionType; icon: IconName }) {
  const router = useRouter();
  const me = useMe();
  const guide = ACTION_TYPE_GUIDE[actionType];
  const typeLabel = guide?.label ?? actionType;
  const drafts = useRoomActionDrafts(room.id);
  const create = useAction(actionDraftApi.createFromMessage, {
    success: (result) => draftCreatedNotice(result, me.employeeId, typeLabel),
    onSuccess: (result) => {
      closeMenu();
      router.push(`/action-drafts/${result.id}`);
    },
  });

  const existing = openDraftOf(drafts.data ?? [], message.id, actionType);
  if (existing) {
    const byOther = existing.requesterId !== null && existing.requesterId !== me.employeeId;
    return (
      <MessageActionItem
        icon="file"
        aside={byOther ? `${existing.requesterName ?? '다른 사원'}님 초안` : DRAFT_STATUS_LABEL[existing.draftStatus]}
        title={byOther ? `${existing.requesterName ?? '다른 사원'}님이 만든 초안이 이미 있어요` : undefined}
        onClick={() => {
          closeMenu();
          router.push(`/action-drafts/${existing.id}`);
        }}
      >
        {typeLabel} 초안 보기 #{existing.id}
      </MessageActionItem>
    );
  }
  return (
    <MessageActionItem
      icon={icon}
      disabled={drafts.isPending || create.isPending}
      aria-busy={create.isPending || undefined}
      onClick={() => {
        // 모델에 따라 몇십 초 걸린다. 메뉴를 닫아도 다 만들면 초안 화면으로 간다
        toast.info('AI가 메시지를 읽는 중이에요. 다 읽으면 초안을 열어요');
        create.mutate({ messageId: message.id, actionType: actionType === ACTION_TYPE.PURCHASE_REQUISITION_CREATE ? undefined : actionType });
      }}
    >
      {create.isPending ? 'AI가 메시지를 읽는 중…' : (guide?.menuLabel ?? `${typeLabel} 초안 만들기`)}
    </MessageActionItem>
  );
}

/** 사원이 보낸 글 메시지에서만 (시스템·첨부만 있는 메시지 제외). 메뉴를 여는 사람은 이미 방 멤버다 */
const isTextMessage = (message: MessageActionProps['message']) => !message.isSystem && (message.content ?? '').trim() !== '';

function draftActionEntry(key: string, actionType: ActionType, icon: IconName, sortOrder: number): MessageActionEntry {
  const guide = ACTION_TYPE_GUIDE[actionType];
  return {
    key,
    sortOrder,
    // 구매요청은 확정 주체가 메시지 작성자라 누구나 만들 수 있고, 확장 유형은 만드는 사람이 확정 주체라 그 권한이 있어야 보인다
    isAvailable: (message, _room, me) => isTextMessage(message) && (actionType === ACTION_TYPE.PURCHASE_REQUISITION_CREATE || (guide !== undefined && canUse(me, guide.permission))),
    Component: (props) => <MessageDraftAction {...props} actionType={actionType} icon={icon} />,
  };
}

/** 메시지 메뉴 등록 항목 (features/messenger/messageActions.ts의 MESSAGE_ACTIONS에 넣는다) */
export const MESSAGE_DRAFT_ACTIONS: MessageActionEntry[] = [
  draftActionEntry('purchase-requisition-draft', ACTION_TYPE.PURCHASE_REQUISITION_CREATE, 'cart', 10),
  draftActionEntry('sales-order-draft', ACTION_TYPE.SALES_ORDER_CREATE, 'clipboard', 11),
  draftActionEntry('shipment-request-draft', ACTION_TYPE.SHIPMENT_REQUEST_CREATE, 'truck', 12),
  draftActionEntry('allocation-draft', ACTION_TYPE.ALLOCATION_CONFIRM, 'link', 13),
  draftActionEntry('reproduction-plan-draft', ACTION_TYPE.REPRODUCTION_PLAN_CREATE, 'factory', 14),
];
