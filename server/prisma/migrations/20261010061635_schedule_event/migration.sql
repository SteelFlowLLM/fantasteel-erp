-- 일정·일정 참석자 (2026-10-10, ERD schedule_event·schedule_event_attendee)

-- CreateTable
CREATE TABLE "schedule_event" (
    "id" SERIAL NOT NULL,
    "schedule_event_title" VARCHAR NOT NULL,
    "schedule_event_description" TEXT,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "creator_id" INTEGER NOT NULL,
    "link_path" VARCHAR,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "schedule_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_event_attendee" (
    "id" SERIAL NOT NULL,
    "schedule_event_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "schedule_event_attendee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedule_event_creator_id_idx" ON "schedule_event"("creator_id");

-- CreateIndex
CREATE INDEX "schedule_event_start_at_idx" ON "schedule_event"("start_at");

-- CreateIndex
CREATE INDEX "schedule_event_attendee_employee_id_idx" ON "schedule_event_attendee"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_event_attendee_schedule_event_id_employee_id_key" ON "schedule_event_attendee"("schedule_event_id", "employee_id");

-- ── ERD Note: CHECK (Prisma 스키마로 표현되지 않아 직접 쓴다) ──
ALTER TABLE "schedule_event" ADD CONSTRAINT "schedule_event_time_check" CHECK ("end_at" > "start_at");
