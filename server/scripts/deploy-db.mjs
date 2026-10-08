// 공용 DB(Supabase)에 마이그레이션을 반영하는 명령. DB 담당자만, develop에 머지된 마이그레이션만 반영한다 (SERVER-GUIDE 8장).
//   npm run db:deploy -w @fantasteel/server             ← 마이그레이션 반영 + TypedSQL 생성
//   npm run db:deploy -w @fantasteel/server -- --seed   ← 처음 한 번: 사원이 없는 빈 DB면 시드도 넣는다
import { execSync } from 'node:child_process';
import pg from 'pg';
import { databaseUrl, describeDatabase, migrateUrl } from './db-target.mjs';

const git = (args) => execSync(`git ${args}`, { encoding: 'utf8' }).trim();
const stop = (message) => {
  process.stderr.write(`[db:deploy] ${message}\n`);
  process.exit(1);
};

// 머지 전 브랜치의 마이그레이션이 공용 DB에 들어가면 되돌리기 어려워 최신 develop에서만 반영한다
execSync('git fetch origin develop', { stdio: 'ignore' });
if (git('branch --show-current') !== 'develop') stop('develop 브랜치에서만 반영합니다');
if (git('status --porcelain') !== '') stop('고치던 파일이 있습니다. 커밋하거나 stash한 뒤 다시 실행하세요');
if (git('rev-parse HEAD') !== git('rev-parse origin/develop')) stop('origin/develop과 다릅니다. git pull 뒤 다시 실행하세요');

process.stdout.write(`[db:deploy] 대상: ${describeDatabase(migrateUrl)}\n`);
execSync('npx prisma migrate deploy', { stdio: 'inherit' });

if (process.argv.includes('--seed')) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const { rows } = await client.query('select count(*)::int as n from employee');
  await client.end();
  if (rows[0].n === 0) execSync('npx tsx prisma/seed.ts', { stdio: 'inherit' });
  else process.stdout.write('[db:deploy] 사원이 이미 있어 시드는 건너뜁니다\n');
}

execSync('npx prisma generate --sql', { stdio: 'inherit' });
