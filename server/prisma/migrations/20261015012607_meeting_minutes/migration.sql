-- Voice2ERP 회의록·참석자, 업무·일정·초안의 원본 회의록 연결 (2026-10-15, ERD meeting_minutes·meeting_attendee)
-- 연결 칼럼은 모두 NULL 허용이라 기존 행은 그대로 둔다

-- AlterTable
ALTER TABLE "action_draft" ADD COLUMN     "meeting_minutes_id" INTEGER;

-- AlterTable
ALTER TABLE "schedule_event" ADD COLUMN     "meeting_minutes_id" INTEGER;

-- AlterTable
ALTER TABLE "task" ADD COLUMN     "meeting_minutes_id" INTEGER;

-- CreateTable
CREATE TABLE "meeting_minutes" (
    "id" SERIAL NOT NULL,
    "meeting_minutes_title" VARCHAR NOT NULL,
    "meeting_date" DATE NOT NULL,
    "meeting_minutes_status" VARCHAR NOT NULL,
    "transcript" TEXT,
    "transcript_segments" JSONB,
    "summary" TEXT,
    "analysis_result" JSONB,
    "failure_reason" VARCHAR,
    "creator_id" INTEGER NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "meeting_minutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_attendee" (
    "id" SERIAL NOT NULL,
    "meeting_minutes_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "meeting_attendee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meeting_minutes_creator_id_idx" ON "meeting_minutes"("creator_id");

-- CreateIndex
CREATE INDEX "meeting_minutes_meeting_date_idx" ON "meeting_minutes"("meeting_date");

-- CreateIndex
CREATE INDEX "meeting_attendee_employee_id_idx" ON "meeting_attendee"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_attendee_meeting_minutes_id_employee_id_key" ON "meeting_attendee"("meeting_minutes_id", "employee_id");

-- CreateIndex
CREATE INDEX "action_draft_meeting_minutes_id_idx" ON "action_draft"("meeting_minutes_id");

-- CreateIndex
CREATE INDEX "schedule_event_meeting_minutes_id_idx" ON "schedule_event"("meeting_minutes_id");

-- CreateIndex
CREATE INDEX "task_meeting_minutes_id_idx" ON "task"("meeting_minutes_id");

-- ── ERD Note: CHECK (Prisma 스키마로 표현되지 않아 직접 쓴다) ──
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_status_check" CHECK ("meeting_minutes_status" IN ('TRANSCRIBING', 'TRANSCRIBED', 'ANALYZING', 'REVIEW', 'CONFIRMED', 'FAILED'));
