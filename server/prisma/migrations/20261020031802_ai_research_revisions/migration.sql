-- CreateTable
CREATE TABLE "ai_research_report_version" (
    "id" SERIAL NOT NULL,
    "run_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "instruction" TEXT,
    "search" BOOLEAN NOT NULL DEFAULT false,
    "report" TEXT NOT NULL,
    "charts" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_research_report_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_research_report_version_run_id_version_key" ON "ai_research_report_version"("run_id", "version");

-- CHECK: 판 번호는 1부터, 이벤트 종류에 보고서 고치기 둘을 더한다 (이슈 #418)
ALTER TABLE "ai_research_report_version" ADD CONSTRAINT "ai_research_report_version_version_check" CHECK ("version" >= 1);
ALTER TABLE "ai_research_event" DROP CONSTRAINT "ai_research_event_type_check";
ALTER TABLE "ai_research_event" ADD CONSTRAINT "ai_research_event_type_check" CHECK ("type" IN ('plan.ready', 'step.started', 'search.done', 'source.added', 'page.read', 'state.updated', 'audit.ready', 'report.ready', 'failed', 'cancelled', 'budget.exhausted', 'charts.ready', 'revision.requested', 'revision.ready'));
