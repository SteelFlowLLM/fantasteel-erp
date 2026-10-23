// 메신저 화면이 함께 쓰는 값 (BP-MSG-01): 메시지 본문 길이 상한과 @멘션 대상.
// 안 읽은 수·멘션 알림·업무방 알림 규칙은 서버가 맡는다(server/src/modules/messenger).

/** 메시지 본문 최대 길이 (가정값: ERD text라 제한이 없어 화면 입력을 4000자로 둔다) */
export const MESSAGE_CONTENT_MAX = 4000;

/** @로 부를 수 있는 대상: 방 멤버(보내는 사람 제외)와 부서 (BP-MSG-01 "멘션을 개인·부서 알림으로 전달") */
export interface MentionTarget {
  kind: 'employee' | 'department';
  id: number;
  name: string;
}
