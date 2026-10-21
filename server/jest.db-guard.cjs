// DB 시험은 npm test(scripts/test.mjs)가 묶음마다 만든 fs_* 전용 DB에서만 돈다 (이슈 #447).
// npx jest로 바로 돌리면 DATABASE_URL이 없거나 .env의 개발 DB라, PrismaService 기본값(fantasteel)에 붙어
// 시험의 deleteMany가 개발 DB의 Notion 연결·회의록·일정을 지웠다. 그런 주소는 없는 DB로 바꿔 붙지 못하게 한다.
// DB를 쓰지 않는 단위 시험(npm run test:unit)은 그대로 돈다.
const BLOCKED_DB = 'fs_blocked_run_db_tests_with_npm_test';

function databaseName(url) {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

if (!databaseName(process.env.DATABASE_URL ?? '').startsWith('fs_')) {
  const blocked = `postgresql://postgres:postgres@localhost:54322/${BLOCKED_DB}`;
  process.env.DATABASE_URL = blocked;
  process.env.DIRECT_URL = blocked;
}
