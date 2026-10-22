-- 초안 행을 잠근다 (#531). 확정·수정·반려·실행이 같은 초안을 동시에 바꾸지 않게 한다.
-- Prisma updateMany의 조건(updated_at = 읽은 값)은 동시 요청에서 둘 다 통과할 수 있어(더블클릭 → 확정 작업 로그 2건) 행을 먼저 잠그고 다시 읽는다
-- @param {Int} $1:actionDraftId
SELECT id, draft_status, updated_at
FROM action_draft
WHERE id = $1
FOR UPDATE;
