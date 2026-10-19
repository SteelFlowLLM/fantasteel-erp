-- 철강맨AI 대화 하나를 트랜잭션이 끝날 때까지 잠근다 (이슈 #399). 두 탭에서 같은 대화에 이어 물어도 순번이 겹치지 않고, 카드 상태를 함께 고쳐도 덮어쓰지 않게
-- @param {Int} $1:threadId
SELECT 1 AS locked
FROM pg_advisory_xact_lock(hashtext('ai_chat_thread:' || $1::text));
