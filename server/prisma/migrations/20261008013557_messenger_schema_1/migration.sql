-- DropIndex
DROP INDEX "message_chat_room_id_idx";

-- AlterTable
ALTER TABLE "message" ADD COLUMN     "client_message_id" VARCHAR(64),
ADD COLUMN     "deleted_at" TIMESTAMPTZ(3),
ADD COLUMN     "edited_at" TIMESTAMPTZ(3),
ADD COLUMN     "message_type" VARCHAR NOT NULL DEFAULT 'USER',
ADD COLUMN     "parent_message_id" INTEGER,
ALTER COLUMN "sender_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "message_chat_room_id_id_idx" ON "message"("chat_room_id", "id");

-- CreateIndex
CREATE INDEX "message_parent_message_id_idx" ON "message"("parent_message_id");

-- ── ERD Note: CHECK·부분 unique (Prisma 스키마로 표현되지 않아 직접 쓴다) ──

-- message: 사람이 보낸 메시지는 보낸 사람 필수, 시스템 메시지는 보낸 사람 없음 (기존 행은 모두 USER)
ALTER TABLE "message" ADD CONSTRAINT "message_type_sender_check" CHECK (
  ("message_type" = 'USER' AND "sender_id" IS NOT NULL)
  OR ("message_type" = 'SYSTEM' AND "sender_id" IS NULL)
);

-- message: 같은 사람이 같은 보내기 id로 두 번 저장하지 않음 (재전송 중복 방지)
CREATE UNIQUE INDEX "message_sender_client_message_id_key" ON "message" ("sender_id", "client_message_id") WHERE "client_message_id" IS NOT NULL;
