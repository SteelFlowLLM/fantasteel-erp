-- EX 과거 사례·관련 LOT (2026-10-16, ERD past_case·past_case_lot). 새 테이블만 만들어 기존 행은 그대로 둔다

-- CreateTable
CREATE TABLE "past_case" (
    "id" SERIAL NOT NULL,
    "case_no" VARCHAR NOT NULL,
    "case_category" VARCHAR NOT NULL,
    "title" VARCHAR NOT NULL,
    "phenomenon" TEXT NOT NULL,
    "cause" TEXT,
    "action_taken" TEXT,
    "equipment_text" VARCHAR,
    "occurred_date" DATE NOT NULL,
    "created_employee_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "past_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "past_case_lot" (
    "id" SERIAL NOT NULL,
    "past_case_id" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "past_case_lot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "past_case_case_no_key" ON "past_case"("case_no");

-- CreateIndex
CREATE INDEX "past_case_created_employee_id_idx" ON "past_case"("created_employee_id");

-- CreateIndex
CREATE INDEX "past_case_lot_lot_id_idx" ON "past_case_lot"("lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "past_case_lot_past_case_id_lot_id_key" ON "past_case_lot"("past_case_id", "lot_id");

-- ── ERD Note: 예시 사례 CASE-0001~0005(코드 안 id 1~5)와 상세 조회 id가 겹치지 않게 등록 사례 id는 6부터 ──
ALTER SEQUENCE "past_case_id_seq" RESTART WITH 6;
