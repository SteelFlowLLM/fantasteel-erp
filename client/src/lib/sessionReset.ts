// 로그아웃하거나 다른 사원으로 들어올 때 앞 사원의 화면 데이터를 모두 비운다 (이슈 #476).
// 같은 탭에서 사원이 바뀌어도 조회 캐시(사원 id가 키에 없는 결재함·구매요청 폼·처분·검사 대기 등)와
// 메모리에만 있는 보내기 실패 메시지가 다음 사원에게 보이거나 그 이름으로 다시 보내지는 일이 없게 한다.
import type { QueryClient } from '@tanstack/react-query';
import { clearAiChipPreferences } from '@/lib/aiChipPreferences';
import { useAiChatStore } from '@/stores/useAiChatStore';
import { useBriefingStore } from '@/stores/useBriefingStore';
import { useMessageComposeStore } from '@/stores/useMessageComposeStore';
import { useMessengerLiveStore } from '@/stores/useMessengerLiveStore';
import { useOutboxStore } from '@/stores/useOutboxStore';
import { useSessionStore } from '@/stores/useSessionStore';

/** 사원마다 다른 화면 데이터를 비운다 */
export function clearSessionData(queryClient: QueryClient): void {
  queryClient.clear();
  useOutboxStore.setState({ items: [] });
  useMessageComposeStore.setState({ replyTo: null, editing: null, deleting: null, tasking: null });
  useMessengerLiveStore.getState().reset();
  useAiChatStore.getState().clear();
  useBriefingStore.getState().reset();
  // 철강맨AI 칩 설정(Drive·브라우저 등)은 이 브라우저에 저장돼 있어 다음 사원에게 켜진 채 시작하지 않게 지운다
  clearAiChipPreferences();
}

/**
 * 로그인한 사원이 있다가 없어지거나(로그아웃·세션 끊김) 다른 사원으로 바뀌면 clearSessionData를 부른다.
 * 처음 불러올 때(사원 없음 → 있음)는 앞 사원이 없어 비우지 않는다. 구독을 푸는 함수를 돌려준다.
 */
export function watchSessionChange(queryClient: QueryClient): () => void {
  return useSessionStore.subscribe((state, previous) => {
    if (previous.employeeId !== null && state.employeeId !== previous.employeeId) clearSessionData(queryClient);
  });
}
