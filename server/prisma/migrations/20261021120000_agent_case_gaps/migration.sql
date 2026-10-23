-- Agent 대응 후보의 같은 대상 미처리 중복 방지 + 과거 사례 구분 CHECK (2026-10-21, 이슈 #464, ERD action_draft·past_case Note).
-- 칸·테이블은 바꾸지 않고 인덱스와 제약만 더한다. 기존 행은 중복 정리 한 번만 고친다.

-- ── 1. 이미 있는 같은 대상의 미처리 후보 중복 정리 ──
-- 같은 targetKey에 AI_GENERATED·WAITING_APPROVAL·APPROVED 후보가 둘 이상이면 가장 진행된 1건
-- (APPROVED > WAITING_APPROVAL > AI_GENERATED, 같으면 id가 작은 것)만 남기고 나머지를 REJECTED로 닫는다.
-- 삭제하지 않으므로 작업 로그(business_event.action_draft_id)·구매요청 연결은 그대로다.
WITH ranked AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY ("payload"->'agent'->>'targetKey')
           ORDER BY CASE "draft_status" WHEN 'APPROVED' THEN 0 WHEN 'WAITING_APPROVAL' THEN 1 ELSE 2 END, "id"
         ) AS "rank"
  FROM "action_draft"
  WHERE "message_id" IS NULL
    AND "payload"->'agent'->>'targetKey' IS NOT NULL
    AND "draft_status" IN ('AI_GENERATED', 'WAITING_APPROVAL', 'APPROVED')
)
UPDATE "action_draft"
SET "draft_status" = 'REJECTED',
    "reject_reason" = '[자동] 같은 대상의 미처리 후보가 이미 있어 정리했어요',
    "updated_at" = CURRENT_TIMESTAMP
FROM "ranked"
WHERE "action_draft"."id" = "ranked"."id" AND "ranked"."rank" > 1;

-- ── 2. Agent 후보: 같은 대상(targetKey)의 미처리 후보는 하나 (REQ-AGT-005) ──
-- 서버가 대상마다 후보를 만들기 전에 확인하지만, 서버를 둘 이상 띄워도 DB가 막도록 한다.
CREATE UNIQUE INDEX "action_draft_open_agent_target_key" ON "action_draft" (("payload"->'agent'->>'targetKey'))
  WHERE "message_id" IS NULL
    AND "payload"->'agent'->>'targetKey' IS NOT NULL
    AND "draft_status" IN ('AI_GENERATED', 'WAITING_APPROVAL', 'APPROVED');

-- ── 3. 과거 사례 구분 (CASE_CATEGORY 확정) ──
-- 서버가 DTO로 값을 확인해 왔으므로 기존 행은 이 값뿐이다.
ALTER TABLE "past_case" ADD CONSTRAINT "past_case_category_check" CHECK ("case_category" IN ('QUALITY', 'EQUIPMENT'));
