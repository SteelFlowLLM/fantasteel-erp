-- 메신저 스키마 3차: 메시지 1건에 파일 여러 개 (message_attachment)

-- CreateTable
CREATE TABLE "message_attachment" (
    "id" SERIAL NOT NULL,
    "message_id" INTEGER NOT NULL,
    "file_path" VARCHAR NOT NULL,
    "file_name" VARCHAR NOT NULL,
    "file_size" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_attachment_message_id_sort_order_idx" ON "message_attachment"("message_id", "sort_order");

-- 옛 첨부(메시지 1건에 파일 1개)를 새 테이블로 옮긴다. 크기는 저장하지 않았으므로 null
INSERT INTO "message_attachment" ("message_id", "file_path", "file_name", "file_size", "sort_order", "created_at", "updated_at")
SELECT "id", "attachment_path", COALESCE("attachment_name", 'file'), NULL, 0, "created_at", "created_at"
FROM "message"
WHERE "attachment_path" IS NOT NULL;

-- AlterTable
ALTER TABLE "message" DROP COLUMN "attachment_name",
DROP COLUMN "attachment_path";
