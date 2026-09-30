-- CreateIndex
CREATE INDEX "business_event_lot_ids_idx" ON "business_event" USING GIN ("lot_ids");
