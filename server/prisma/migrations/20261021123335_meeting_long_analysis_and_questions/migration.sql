-- AlterTable
ALTER TABLE "ai_chat_thread" ADD COLUMN     "meeting_minutes_id" INTEGER;

-- AlterTable
ALTER TABLE "meeting_minutes" ADD COLUMN     "analysis_progress" JSONB;

-- CreateIndex
CREATE INDEX "ai_chat_thread_meeting_minutes_id_idx" ON "ai_chat_thread"("meeting_minutes_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_chat_thread_employee_id_meeting_minutes_id_key" ON "ai_chat_thread"("employee_id", "meeting_minutes_id");

