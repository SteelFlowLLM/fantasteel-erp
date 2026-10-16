-- 외부 연결(MCP·OAuth) 저장과 회의록 Notion 내보내기 (2026-10-16, 이슈 #358, ERD integration_connection·meeting_minutes). 새 테이블과 null 허용 칸만 더해 기존 행은 그대로 둔다

-- AlterTable
ALTER TABLE "meeting_minutes" ADD COLUMN     "notion_exported_at" TIMESTAMPTZ(3),
ADD COLUMN     "notion_page_url" VARCHAR;

-- CreateTable
CREATE TABLE "integration_connection" (
    "id" SERIAL NOT NULL,
    "provider_key" VARCHAR NOT NULL,
    "server_url" VARCHAR,
    "oauth_client_information" TEXT,
    "oauth_tokens" TEXT,
    "oauth_code_verifier" TEXT,
    "oauth_state" VARCHAR,
    "oauth_state_expires_at" TIMESTAMPTZ(3),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "connected_by_id" INTEGER,
    "connected_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_connection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_connection_provider_key_key" ON "integration_connection"("provider_key");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connection_oauth_state_key" ON "integration_connection"("oauth_state");

-- CreateIndex
CREATE INDEX "integration_connection_connected_by_id_idx" ON "integration_connection"("connected_by_id");

