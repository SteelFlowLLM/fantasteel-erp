-- CreateTable
CREATE TABLE "ai_action_card_run" (
    "id" SERIAL NOT NULL,
    "card_id" VARCHAR NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "card_kind" VARCHAR NOT NULL,
    "run_status" VARCHAR NOT NULL,
    "result" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_action_card_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_action_card_run_employee_id_card_id_key" ON "ai_action_card_run"("employee_id", "card_id");


-- 실행 상태는 공통 코드가 아니라 CHECK로 막는다
ALTER TABLE "ai_action_card_run" ADD CONSTRAINT "ai_action_card_run_status_check" CHECK ("run_status" IN ('RUNNING', 'DONE'));
