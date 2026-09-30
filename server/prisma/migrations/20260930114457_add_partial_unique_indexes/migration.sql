-- 수주 1건당 업무방 1개
CREATE UNIQUE INDEX "chat_room_work_sales_order_id_key" ON "chat_room" ("sales_order_id") WHERE "chat_room_type" = 'WORK' AND "sales_order_id" IS NOT NULL;
-- 같은 메시지·유형의 미처리 초안은 1건
CREATE UNIQUE INDEX "action_draft_open_message_key" ON "action_draft" ("message_id", "action_type") WHERE "draft_status" IN ('AI_GENERATED', 'WAITING_APPROVAL', 'APPROVED') AND "message_id" IS NOT NULL;
-- steel_grade_id 가 NULL 인 행의 중복 방지 (일반 unique 는 NULL 을 서로 다르게 본다)
CREATE UNIQUE INDEX "specific_consumption_common_key" ON "specific_consumption" ("raw_material_id") WHERE "steel_grade_id" IS NULL;
CREATE UNIQUE INDEX "inspection_item_common_key" ON "inspection_item" ("process_code", "inspection_item_code") WHERE "steel_grade_id" IS NULL;
