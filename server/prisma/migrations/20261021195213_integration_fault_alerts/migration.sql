-- 외부 연결 장애 알림과 Notion 반영 실패 목록 (2026-10-22, 이슈 #518, ERD integration_fault·notion_sync_failure·integration_connection.last_error_at). 새 테이블과 null 허용 칸만 더해 기존 행은 그대로 둔다

-- AlterTable
ALTER TABLE "integration_connection" ADD COLUMN     "last_error_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "integration_fault" (
    "id" SERIAL NOT NULL,
    "provider_key" VARCHAR NOT NULL,
    "fault_kind" VARCHAR NOT NULL,
    "failure_count" INTEGER NOT NULL DEFAULT 1,
    "last_message" VARCHAR NOT NULL,
    "first_failed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_failed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_fault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notion_sync_failure" (
    "id" SERIAL NOT NULL,
    "target_type" VARCHAR NOT NULL,
    "target_id" INTEGER NOT NULL,
    "failure_count" INTEGER NOT NULL DEFAULT 1,
    "last_error" VARCHAR NOT NULL,
    "is_result_unknown" BOOLEAN NOT NULL DEFAULT false,
    "retry_after" TIMESTAMPTZ(3) NOT NULL,
    "first_failed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_failed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notion_sync_failure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_fault_provider_key_fault_kind_key" ON "integration_fault"("provider_key", "fault_kind");

-- CreateIndex
CREATE INDEX "notion_sync_failure_retry_after_idx" ON "notion_sync_failure"("retry_after");

-- CreateIndex
CREATE UNIQUE INDEX "notion_sync_failure_target_type_target_id_key" ON "notion_sync_failure"("target_type", "target_id");

-- ── ERD Note: CHECK (Prisma 스키마로 표현되지 않아 직접 쓴다) ──
ALTER TABLE "integration_fault" ADD CONSTRAINT "integration_fault_kind_check" CHECK ("fault_kind" IN ('RECONNECT_REQUIRED', 'CREDENTIAL_ERROR', 'REQUEST_FAILED', 'SYNC_FAILED'));
ALTER TABLE "integration_fault" ADD CONSTRAINT "integration_fault_failure_count_check" CHECK ("failure_count" >= 1);
ALTER TABLE "notion_sync_failure" ADD CONSTRAINT "notion_sync_failure_target_type_check" CHECK ("target_type" IN ('schedule_event', 'meeting_minutes', 'task'));
ALTER TABLE "notion_sync_failure" ADD CONSTRAINT "notion_sync_failure_failure_count_check" CHECK ("failure_count" >= 1);
