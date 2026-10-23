// npm run dev 에서 서버를 띄우기 전에 DB를 쓸 수 있게 맞춘다. 반복 실행해도 안전하다.
//   1) 로컬 DB(npm run db)면 fantasteel DB가 만들어질 때까지 기다린다
//   2) 아직 적용되지 않은 마이그레이션을 적용한다 (prisma migrate deploy)
//   3) 사원이 한 명도 없으면(빈 DB) 시드를 넣는다
//   4) prisma/sql/*.sql(TypedSQL) 타입을 만든다 (DB가 떠 있어야 해서 여기서 한다, 컨벤션 8장)
// 2)·3)은 로컬 DB일 때만 한다. 공용 DB(Supabase)는 누가 dev를 켜도 바뀌지 않게 db:deploy로만 반영한다 (SERVER-GUIDE 8장).
import { execSync } from 'node:child_process';
import pg from 'pg';
import { databaseUrl as url, describeDatabase, remoteUrl } from './db-target.mjs';

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

if (remoteUrl) {
  process.stdout.write(`[db] 공용 DB(${describeDatabase(remoteUrl)})라 마이그레이션·시드는 건너뜁니다. 반영은 DB 담당자가 db:deploy로 합니다\n`);
} else {
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });

  client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query('select count(*)::int as n from employee');
  await client.end();
  if (rows[0].n === 0) {
    process.stdout.write('[db] 빈 DB라 시드를 넣습니다\n');
    execSync('npx tsx prisma/seed.ts', { stdio: 'inherit' });
  }
}

execSync('npx prisma generate --sql', { stdio: 'inherit' });
