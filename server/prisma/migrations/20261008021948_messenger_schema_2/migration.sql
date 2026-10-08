-- AlterTable
ALTER TABLE "chat_room" ADD COLUMN     "pinned_message_id" INTEGER;

-- AlterTable
ALTER TABLE "chat_room_member" ADD COLUMN     "muted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinned_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "task" ADD COLUMN     "message_id" INTEGER;

-- CreateTable
CREATE TABLE "message_reaction" (
    "id" SERIAL NOT NULL,
    "message_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "emoji" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_reaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_reaction_employee_id_idx" ON "message_reaction"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_reaction_message_id_employee_id_emoji_key" ON "message_reaction"("message_id", "employee_id", "emoji");

-- CreateIndex
CREATE INDEX "task_message_id_idx" ON "task"("message_id");
