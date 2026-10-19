-- CreateTable
CREATE TABLE "ai_chat_thread" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "title" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_chat_thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_chat_message" (
    "id" SERIAL NOT NULL,
    "thread_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" VARCHAR NOT NULL,
    "content" TEXT NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "web_sources" JSONB,
    "action_cards" JSONB,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_chat_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_chat_thread_employee_id_updated_at_idx" ON "ai_chat_thread"("employee_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_chat_message_thread_id_seq_key" ON "ai_chat_message"("thread_id", "seq");

-- ── ERD Note: CHECK (Prisma 스키마로 표현되지 않아 직접 쓴다) ──
ALTER TABLE "ai_chat_message" ADD CONSTRAINT "ai_chat_message_role_check" CHECK ("role" IN ('USER', 'ASSISTANT'));
ALTER TABLE "ai_chat_message" ADD CONSTRAINT "ai_chat_message_seq_check" CHECK ("seq" >= 1);
