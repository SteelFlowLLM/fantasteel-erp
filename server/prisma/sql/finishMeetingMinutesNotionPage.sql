-- 회의록 데이터베이스에 만든 페이지를 남긴다 (이슈 #391). 내가 잡은 내보내기(notion_exported_at = claimedAt)만 끝낸다. 반환 행이 없으면 잡기를 잃었다
-- updated_at은 건드리지 않는다: 반영한 행의 updated_at을 notion_synced_at에 넣는다
-- @param {Int} $1:id
-- @param {String} $2:notionPageUrl
-- @param {String} $3:notionPageId
-- @param {DateTime} $4:exportedAt
-- @param {DateTime} $5:syncedAt
-- @param {DateTime} $6:claimedAt
UPDATE meeting_minutes
   SET notion_page_url = $2,
       notion_page_id = $3,
       notion_exported_at = $4,
       notion_synced_at = $5
 WHERE id = $1
   AND notion_page_url IS NULL
   AND notion_exported_at = $6
RETURNING id;
