-- AlterTable
ALTER TABLE "employee" ADD COLUMN     "email" VARCHAR;

-- AlterTable
ALTER TABLE "meeting_minutes" ADD COLUMN     "notion_page_id" VARCHAR,
ADD COLUMN     "notion_synced_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "schedule_event" ADD COLUMN     "notion_calendar_event_id" VARCHAR,
ADD COLUMN     "notion_page_id" VARCHAR,
ADD COLUMN     "notion_synced_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "task" ADD COLUMN     "notion_page_id" VARCHAR,
ADD COLUMN     "notion_synced_at" TIMESTAMPTZ(3);
