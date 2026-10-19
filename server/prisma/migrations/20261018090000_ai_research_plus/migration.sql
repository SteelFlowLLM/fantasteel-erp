-- 심층 조사 차트·Notion 내보내기 (이슈 #384, 문서에 없는 기능). 칸만 더한다
ALTER TABLE "ai_research_run" ADD COLUMN "charts" JSONB;
ALTER TABLE "ai_research_run" ADD COLUMN "notion_page_url" VARCHAR;
ALTER TABLE "ai_research_run" ADD COLUMN "notion_exported_at" TIMESTAMPTZ(3);

-- ── ERD Note: CHECK — 이벤트 종류에 charts.ready를 더한다 ──
ALTER TABLE "ai_research_event" DROP CONSTRAINT "ai_research_event_type_check";
ALTER TABLE "ai_research_event" ADD CONSTRAINT "ai_research_event_type_check" CHECK ("type" IN ('plan.ready', 'step.started', 'search.done', 'source.added', 'page.read', 'state.updated', 'audit.ready', 'report.ready', 'failed', 'cancelled', 'budget.exhausted', 'charts.ready'));
