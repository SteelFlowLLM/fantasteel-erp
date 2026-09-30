// 로컬 DB를 지우고 다시 만든다 (스키마 + 시드). 로컬 개발·시연용 DB에만 쓴다.
//   node scripts/reset-db.mjs fantasteel     ← 개발·시연 DB 초기화 (데이터가 모두 사라진다)
//   node scripts/reset-db.mjs fs_e2e
import { execSync } from 'node:child_process';
import pg from 'pg';

const name = process.argv[2];
if (!name || !/^(fantasteel|fs_[a-z0-9_]+)$/.test(name)) {
  process.stderr.write('사용법: node scripts/reset-db.mjs <fantasteel | fs_이름>\n');
  process.exit(1);
}
const base = 'postgresql://postgres:postgres@localhost:54322';
const admin = new pg.Client({ connectionString: `${base}/postgres` });
await admin.connect();
await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [name]);
await admin.query(`DROP DATABASE IF EXISTS ${name}`);
await admin.query(`CREATE DATABASE ${name}`);
await admin.query(`ALTER DATABASE ${name} SET timezone='UTC'`);
await admin.end();
const env = { ...process.env, DATABASE_URL: `${base}/${name}`, DIRECT_URL: `${base}/${name}` };
execSync('npx prisma migrate deploy', { env, stdio: 'ignore' });
process.stdout.write(execSync('npx tsx prisma/seed.ts', { env }).toString());
