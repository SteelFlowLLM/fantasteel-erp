-- LOT당 CONFIRMED 배정은 1건 (REQ-INV-009)
CREATE UNIQUE INDEX "allocation_lot_id_confirmed_key" ON "allocation" ("lot_id") WHERE "status" = 'CONFIRMED';

-- 핵심 상태 컬럼 CHECK (코드 컨벤션 4장 권장)
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_status_check" CHECK ("status" IN ('ACTIVE', 'CONVERTED', 'RELEASED'));
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_status_check" CHECK ("status" IN ('CONFIRMED', 'CONSUMED', 'RELEASED'));
ALTER TABLE "action_draft" ADD CONSTRAINT "action_draft_draft_status_check" CHECK ("draft_status" IN ('AI_GENERATED', 'WAITING_APPROVAL', 'APPROVED', 'EXECUTED', 'REJECTED'));

-- 불변조건
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_non_negative_check" CHECK ("on_hand_qty" >= 0 AND "reserved_qty" >= 0 AND "on_hand_ton" >= 0 AND "reserved_qty" <= "on_hand_qty");
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_target_check" CHECK (("product_spec_id" IS NULL) <> ("raw_material_id" IS NULL));
ALTER TABLE "lot" ADD CONSTRAINT "lot_remaining_ton_check" CHECK ("remaining_ton" IS NULL OR "remaining_ton" >= 0);
ALTER TABLE "sales_order_item" ADD CONSTRAINT "sales_order_item_qty_check" CHECK ("ordered_qty" >= 1 AND "shipped_qty" >= 0 AND "shipped_qty" <= "ordered_qty");
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_qty_check" CHECK ("reserved_qty" >= 1);
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_received_check" CHECK ("received_ton" >= 0 AND "received_ton" <= "ordered_ton");
