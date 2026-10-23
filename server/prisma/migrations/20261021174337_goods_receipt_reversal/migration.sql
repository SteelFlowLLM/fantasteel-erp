-- AlterTable
ALTER TABLE "goods_receipt" ADD COLUMN     "reversed_goods_receipt_id" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_reversed_goods_receipt_id_key" ON "goods_receipt"("reversed_goods_receipt_id");


-- 입고 취소(반대 거래)는 음수 입고 행으로 남긴다. 원래 입고는 양수, 취소 행만 음수이고 취소한 입고를 가리킨다 (이슈 #500)
ALTER TABLE "goods_receipt" DROP CONSTRAINT "goods_receipt_received_ton_check";
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_received_ton_check" CHECK (("reversed_goods_receipt_id" IS NULL AND "received_ton" > 0) OR ("reversed_goods_receipt_id" IS NOT NULL AND "received_ton" < 0));
