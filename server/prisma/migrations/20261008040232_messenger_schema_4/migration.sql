-- 메신저 스키마 4차: 이모티콘 메시지 (message.emoticon_key)

-- AlterTable
ALTER TABLE "message" ADD COLUMN     "emoticon_key" VARCHAR(32);
