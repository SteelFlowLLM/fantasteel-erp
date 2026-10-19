-- Notion 회의록 데이터베이스 페이지를 고쳤다고 적는다 (이슈 #391). updated_at은 건드리지 않는다
-- @param {Int} $1:id
-- @param {DateTime} $2:syncedAt
UPDATE meeting_minutes
   SET notion_synced_at = $2
 WHERE id = $1
RETURNING id;
