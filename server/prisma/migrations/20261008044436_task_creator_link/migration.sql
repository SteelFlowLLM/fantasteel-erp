-- 업무 등록자·연결 화면 (2026-10-08, ERD task.creator_id·link_path)
-- 이미 있는 업무는 등록자를 알 수 없어 담당자로 채운 뒤 NOT NULL로 바꾼다 (SERVER-GUIDE 7장: 데이터가 있는 표에 기본값 없는 NOT NULL을 바로 넣지 않는다)

-- AlterTable
ALTER TABLE "task" ADD COLUMN     "creator_id" INTEGER,
ADD COLUMN     "link_path" VARCHAR;

UPDATE "task" SET "creator_id" = "assignee_id" WHERE "creator_id" IS NULL;

ALTER TABLE "task" ALTER COLUMN "creator_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "task_creator_id_idx" ON "task"("creator_id");
