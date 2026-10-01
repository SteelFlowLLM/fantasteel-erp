// Message → ERP 초안 조회 훅 (변경은 화면에서 useAction(actionDraftApi.…)으로)
import { skipToken, useQuery } from '@tanstack/react-query';
import { actionDraftApi, actionDraftKeys } from '@/api/actionDrafts';
import { useMe } from '@/hooks/useMe';

export function useActionDraft(actionDraftId: number | null) {
  const me = useMe();
  return useQuery({
    queryKey: actionDraftKeys.detail(me.employeeId, actionDraftId ?? 0),
    queryFn: actionDraftId === null ? skipToken : () => actionDraftApi.get(actionDraftId),
    retry: false,
  });
}

/** 내가 요청자인 초안 (구매요청 목록의 '확인 대기 초안' 같은 곳에서도 쓸 수 있다) */
export function useMyActionDrafts() {
  const me = useMe();
  return useQuery({ queryKey: actionDraftKeys.mine(me.employeeId), queryFn: actionDraftApi.listMine });
}

/** 이 채팅방 메시지에 달린 초안 (메시지 메뉴) */
export function useRoomActionDrafts(chatRoomId: number) {
  const me = useMe();
  return useQuery({ queryKey: actionDraftKeys.room(me.employeeId, chatRoomId), queryFn: () => actionDraftApi.listOfRoom(chatRoomId), retry: false });
}

/** 이 메시지로 초안을 만들 수 있는지 (요청자 = 메시지 작성자가 확정할 수 있어야 한다). 메시지 메뉴를 열 때만 부른다. */
export function useDraftRequesterCheck(messageId: number) {
  const me = useMe();
  return useQuery({ queryKey: actionDraftKeys.requester(me.employeeId, messageId), queryFn: () => actionDraftApi.checkRequester(messageId), retry: false });
}

export function useDraftRawMaterials() {
  return useQuery({ queryKey: [...actionDraftKeys.all, 'raw-materials'], queryFn: actionDraftApi.listRawMaterials });
}
