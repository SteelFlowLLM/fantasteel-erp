// 작업 로그의 'AI 경유' 표시 (REQ-AST-010). 서버가 주는 isAiAssisted를 그대로 보인다.
// true인 경우: 철강맨AI 실행 카드, AI가 채운 초안(메시지·회의록)을 확정한 작업, Agent 대응 후보를 확정한 작업.
export const AI_VIA_LABEL = 'AI 경유';

/** 펼친 상세의 'AI 경유' 칸 글 */
export const aiViaText = (isAiAssisted: boolean): string => (isAiAssisted ? 'AI가 채운 초안·카드·후보로 처리한 작업' : '아니오');
