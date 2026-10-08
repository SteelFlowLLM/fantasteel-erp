// 메신저 조회 훅, 읽음 처리, 보내기(보내는 중·실패·다시 보내기)
import { keepPreviousData, skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { messengerApi, messengerKeys, type SendMessageInput } from '@/api/messenger';
import { imageMimeOf } from '@/features/messenger/lib/attachment';
import { useMe } from '@/hooks/useMe';
import { deliverOutboxItem, retryOutboxItem, useOutboxStore } from '@/stores/useOutboxStore';
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

/** 파일 모아보기 (방 정보 칸). 최신순 limit개 */
export function useChatFiles(chatRoomId: number, limit: number) {
  const me = useMe();
  return useQuery({ queryKey: messengerKeys.files(me.employeeId, chatRoomId, limit), queryFn: () => messengerApi.listFiles({ chatRoomId, limit }), placeholderData: keepPreviousData });
}

/** 방 안 메시지 검색. 검색어가 비면 부르지 않는다 */
export function useChatSearch(chatRoomId: number, keyword: string) {
  const me = useMe();
  const trimmed = keyword.trim();
  return useQuery({
    queryKey: messengerKeys.search(me.employeeId, chatRoomId, trimmed),
    queryFn: trimmed ? () => messengerApi.searchMessages({ chatRoomId, keyword: trimmed }) : skipToken,
    retry: false,
  });
}

/** 그림 첨부 미리보기 (REQ-MSG-003). 그림일 때만 읽고, 한 번 읽은 그림은 다시 받지 않는다 */
export function useImagePreview(messageId: number, fileId: number, fileName: string) {
  const me = useMe();
  const isImage = imageMimeOf(fileName) !== null;
  return useQuery({
    queryKey: [...messengerKeys.all, 'image', me.employeeId, messageId, fileId] as const,
    queryFn: isImage ? () => messengerApi.getFile({ messageId, fileId, fileName }) : skipToken,
    staleTime: Infinity,
    retry: false,
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

/**
 * 메시지 보내기 (REQ-MSG-002). 누르면 바로 '보내는 중' 말풍선으로 보이고, 저장되면 조회를 다시 읽은 뒤 말풍선을 지운다(깜빡임 없이 바뀐다).
 * 실패하면 '전송 실패' 말풍선으로 남아 다시 보내거나 지울 수 있다. items는 이 방의 보내는 중·실패 메시지.
 */
export function useMessageOutbox(chatRoomId: number) {
  const queryClient = useQueryClient();
  const all = useOutboxStore((state) => state.items);
  const items = useMemo(() => all.filter((item) => item.input.chatRoomId === chatRoomId), [all, chatRoomId]);

  const sendAndRefresh = useCallback(
    async (input: SendMessageInput) => {
      await messengerApi.sendMessage(input);
      // 멘션·업무방 알림도 함께 생겨서 알림 조회도 다시 읽는다
      await Promise.all([queryClient.invalidateQueries({ queryKey: messengerKeys.all }), queryClient.invalidateQueries({ queryKey: ['notifications'] })]);
    },
    [queryClient],
  );

  const send = useCallback(
    (input: SendMessageInput) => {
      const localId = useOutboxStore.getState().add(input);
      void deliverOutboxItem(localId, sendAndRefresh);
    },
    [sendAndRefresh],
  );
  const retry = useCallback((localId: string) => void retryOutboxItem(localId, sendAndRefresh), [sendAndRefresh]);
  const discard = useCallback((localId: string) => useOutboxStore.getState().remove(localId), []);

  return { items, send, retry, discard };
}
