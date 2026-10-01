// npm run dev 에서 서버를 띄우기 전에 DB를 쓸 수 있게 맞춘다. 반복 실행해도 안전하다.
//   1) 로컬 DB(npm run db)면 fantasteel DB가 만들어질 때까지 기다린다
//   2) 아직 적용되지 않은 마이그레이션을 적용한다 (prisma migrate deploy)
//   3) 직원이 한 명도 없으면(빈 DB) 시드를 넣는다
import 'dotenv/config';
import { execSync } from 'node:child_process';
import pg from 'pg';

const LOCAL = 'postgresql://postgres:postgres@localhost:54322/fantasteel';
const url = process.env.DATABASE_URL ?? LOCAL;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// local-db.mjs는 포트를 연 뒤에 fantasteel DB를 만든다. 그 사이에 접속하면 실패하므로 잠깐 기다린다.
let client;
for (let i = 0; ; i++) {
  client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    break;
  } catch (e) {
    await client.end().catch(() => {});
    if (i >= 30) throw e;
    await sleep(1000);
  }
}
await client.end();

execSync('npx prisma migrate deploy', { stdio: 'inherit' });

client = new pg.Client({ connectionString: url });
await client.connect();
const { rows } = await client.query('select count(*)::int as n from employee');
await client.end();
if (rows[0].n === 0) {
  process.stdout.write('[db] 빈 DB라 시드를 넣습니다\n');
  execSync('npx tsx prisma/seed.ts', { stdio: 'inherit' });
}
