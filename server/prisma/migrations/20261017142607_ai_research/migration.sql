-- 철강맨AI 심층 조사 (2026-10-17, 이슈 #378, ERD ai_research_run·ai_research_event). 새 테이블만 더해 기존 행은 그대로 둔다

-- CreateTable
CREATE TABLE "ai_research_run" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "status" VARCHAR NOT NULL,
    "plan" JSONB,
    "plan_revision" INTEGER NOT NULL DEFAULT 0,
    "budget" JSONB NOT NULL,
    "steps_used" INTEGER NOT NULL DEFAULT 0,
    "research_state" JSONB,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "audit" JSONB,
    "report" TEXT,
    "failure_reason" VARCHAR,
    "lease_owner" VARCHAR,
    "lease_expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_research_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_research_event" (
    "id" SERIAL NOT NULL,
    "run_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" VARCHAR NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_research_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_research_run_employee_id_created_at_idx" ON "ai_research_run"("employee_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_research_run_status_idx" ON "ai_research_run"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_research_event_run_id_seq_key" ON "ai_research_event"("run_id", "seq");

-- ── ERD Note: CHECK (Prisma 스키마로 표현되지 않아 직접 쓴다) ──
ALTER TABLE "ai_research_run" ADD CONSTRAINT "ai_research_run_status_check" CHECK ("status" IN ('PLANNING', 'AWAITING_APPROVAL', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'));
ALTER TABLE "ai_research_event" ADD CONSTRAINT "ai_research_event_type_check" CHECK ("type" IN ('plan.ready', 'step.started', 'search.done', 'source.added', 'page.read', 'state.updated', 'audit.ready', 'report.ready', 'failed', 'cancelled', 'budget.exhausted'));
ALTER TABLE "ai_research_run" ADD CONSTRAINT "ai_research_run_steps_used_check" CHECK ("steps_used" >= 0 AND "plan_revision" >= 0);
