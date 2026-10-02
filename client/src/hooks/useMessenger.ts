// 메신저 조회 훅과 읽음 처리
import { keepPreviousData, skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { messengerApi, messengerKeys } from '@/api/messenger';
import { useMe } from '@/hooks/useMe';
import { toast } from '@/stores/useToastStore';

export function useChatRoomList() {
  const me = useMe();
  return useQuery({ queryKey: messengerKeys.rooms(me.employeeId), queryFn: messengerApi.listRooms });
}

export function useChatRoom(chatRoomId: number | null) {
  const me = useMe();
  return useQuery({
    queryKey: messengerKeys.room(me.employeeId, chatRoomId ?? 0),
    queryFn: chatRoomId === null ? skipToken : () => messengerApi.getRoom(chatRoomId),
    retry: false,
  });
}

export function useChatMessages(chatRoomId: number | null, limit: number) {
  const me = useMe();
  return useQuery({
    queryKey: messengerKeys.messages(me.employeeId, chatRoomId ?? 0, limit),
    queryFn: chatRoomId === null ? skipToken : () => messengerApi.listMessages({ chatRoomId, limit }),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/**
 * 읽음 처리 (REQ-MSG-004). 대화를 보고 있는 동안 자주 부르므로 토스트 없이 메신저 조회(목록·배지)만 다시 부른다.
 * (useAction은 모든 조회를 다시 부르고 실패 토스트를 띄운다)
 */
export function useMarkRoomRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: messengerApi.markRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messengerKeys.all }),
  });
}

/** 첨부 내려받기 (REQ-MSG-003). 방 멤버만 받을 수 있다 (api가 확인) */
export function useMessageFileDownload() {
  return useMutation({
    mutationFn: messengerApi.getFile,
    onSuccess: (file) => {
      const anchor = document.createElement('a');
      anchor.href = file.dataUrl;
      anchor.download = file.name;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
    onError: (error) => toast.apiError(error),
  });
}
