// 대화 목록의 구분선과 연속 메시지 묶기: 날짜 구분선 · 새 메시지 구분선 · 같은 사람이 이어 쓴 메시지
import { fmtDate } from '@/lib/format';

/** 같은 사람이 이 시간 안에 이어 쓰면 한 묶음으로 본다 (가정값: 문서에 정한 값이 없다) */
export const MESSAGE_GROUP_GAP_MS = 5 * 60 * 1000;

export interface GroupableMessage {
  id: number;
  senderId: number;
  isSystem: boolean;
  isMine: boolean;
  createdAt: string;
}

export interface MessageLayout {
  /** 이 메시지 위에 날짜 구분선 */
  showDay: boolean;
  /** 이 메시지 위에 '여기부터 새 메시지' 구분선 */
  showNewDivider: boolean;
  /** 묶음의 첫 메시지 (이름·아바타) */
  isGroupStart: boolean;
  /** 묶음의 마지막 메시지 (시각) */
  isGroupEnd: boolean;
}

/** 방을 열 때의 읽음 위치보다 뒤에 온 남의 메시지 중 첫 번째. 없으면 null */
export function firstUnreadId(messages: readonly GroupableMessage[], lastReadMessageId: number | null): number | null {
  return messages.find((m) => !m.isMine && !m.isSystem && m.id > (lastReadMessageId ?? 0))?.id ?? null;
}

/** 오래된 것부터 정렬된 메시지마다 구분선·묶음 위치를 정한다 */
export function layoutMessages(messages: readonly GroupableMessage[], newDividerId: number | null): MessageLayout[] {
  const breaks = messages.map((message, index) => {
    const prev = messages[index - 1];
    const showDay = !prev || fmtDate(prev.createdAt) !== fmtDate(message.createdAt);
    const showNewDivider = message.id === newDividerId;
    const joinsPrev =
      prev !== undefined &&
      !showDay &&
      !showNewDivider &&
      !prev.isSystem &&
      !message.isSystem &&
      prev.senderId === message.senderId &&
      new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() <= MESSAGE_GROUP_GAP_MS;
    return { showDay, showNewDivider, joinsPrev };
  });
  return breaks.map((current, index) => ({
    showDay: current.showDay,
    showNewDivider: current.showNewDivider,
    isGroupStart: !current.joinsPrev,
    isGroupEnd: !breaks[index + 1]?.joinsPrev,
  }));
}
