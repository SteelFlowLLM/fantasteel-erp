// 작업 로그의 'AI 경유' 표시 (REQ-AST-010). 서버가 주는 isAiAssisted를 그대로 보인다.
export const AI_VIA_LABEL = 'AI 경유';

/** 펼친 상세의 'AI 경유' 칸 글 */
export const aiViaText = (isAiAssisted: boolean): string => (isAiAssisted ? '철강맨AI 실행 카드로 확정한 작업' : '아니오');
