-- AlterTable
ALTER TABLE "ai_research_run" ADD COLUMN     "notion_export_claimed_at" TIMESTAMPTZ(3),
ADD COLUMN     "notion_exported_version" INTEGER,
ADD COLUMN     "schedule_id" INTEGER;

-- CreateTable
CREATE TABLE "ai_research_schedule" (
    "id" SERIAL NOT NULL,
    "run_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "frequency" VARCHAR NOT NULL,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "run_time" VARCHAR NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMPTZ(3),
    "last_run_at" TIMESTAMPTZ(3),
    "last_run_id" INTEGER,
    "last_skip_reason" VARCHAR,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_research_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_research_schedule_run_id_key" ON "ai_research_schedule"("run_id");

-- CreateIndex
CREATE INDEX "ai_research_schedule_employee_id_enabled_idx" ON "ai_research_schedule"("employee_id", "enabled");

-- CreateIndex
CREATE INDEX "ai_research_schedule_enabled_next_run_at_idx" ON "ai_research_schedule"("enabled", "next_run_at");

-- CHECK: 반복 규칙 (이슈 #521). DAILY는 요일 없음, WEEKLY는 1(월)~7(일) 중 1~7개, 시각은 HH:MM(Asia/Seoul). 켜진 반복만 다음 차례가 있다
ALTER TABLE "ai_research_schedule" ADD CONSTRAINT "ai_research_schedule_frequency_check" CHECK ("frequency" IN ('DAILY', 'WEEKLY'));
ALTER TABLE "ai_research_schedule" ADD CONSTRAINT "ai_research_schedule_weekdays_check" CHECK ("weekdays" IS NOT NULL AND "weekdays" <@ ARRAY[1, 2, 3, 4, 5, 6, 7] AND (("frequency" = 'DAILY' AND cardinality("weekdays") = 0) OR ("frequency" = 'WEEKLY' AND cardinality("weekdays") BETWEEN 1 AND 7)));
ALTER TABLE "ai_research_schedule" ADD CONSTRAINT "ai_research_schedule_run_time_check" CHECK ("run_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "ai_research_schedule" ADD CONSTRAINT "ai_research_schedule_next_run_check" CHECK ("enabled" = ("next_run_at" IS NOT NULL));

-- 이벤트 종류에 보고서 시간 초과 다시 시도를 더한다
ALTER TABLE "ai_research_event" DROP CONSTRAINT "ai_research_event_type_check";
ALTER TABLE "ai_research_event" ADD CONSTRAINT "ai_research_event_type_check" CHECK ("type" IN ('plan.ready', 'step.started', 'search.done', 'source.added', 'page.read', 'state.updated', 'audit.ready', 'report.ready', 'failed', 'cancelled', 'budget.exhausted', 'charts.ready', 'revision.requested', 'revision.ready', 'report.retry'));

-- Notion 다시 내보내기: 내보내는 중 표시를 따로 둔다. 옛 잡기(주소 없이 잡은 시각만 있는 행)는 새 칸으로 옮긴다
UPDATE "ai_research_run" SET "notion_export_claimed_at" = "notion_exported_at", "notion_exported_at" = NULL WHERE "notion_page_url" IS NULL AND "notion_exported_at" IS NOT NULL;
