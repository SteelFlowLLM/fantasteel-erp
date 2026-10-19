-- Notion 일정 데이터베이스에 반영했다고 적는다 (이슈 #391). updated_at은 건드리지 않는다: 반영한 행의 updated_at을 notion_synced_at에 넣어 그 뒤에 바뀌면 다시 반영하게 한다
-- @param {Int} $1:id
-- @param {String} $2:notionPageId
-- @param {DateTime} $3:syncedAt
UPDATE schedule_event
   SET notion_page_id = $2,
       notion_synced_at = $3
 WHERE id = $1
RETURNING id;
