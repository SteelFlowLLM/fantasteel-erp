// 서버 테스트 실행기. 실제 DB를 쓰는 테스트가 서로 데이터를 건드리지 않도록 묶음마다 전용 DB(fs_*)를 쓴다.
// 로컬 PostgreSQL(npm run db)이 떠 있어야 한다. 개발용 DB(fantasteel)는 건드리지 않는다.
import { execSync, spawnSync } from 'node:child_process';
import pg from 'pg';

const base = 'postgresql://postgres:postgres@localhost:54322';
const groups = [
  ['fs_org', ['src/modules/organization', 'src/modules/notification', 'src/modules/auth']],
  ['fs_master', ['src/modules/master-data']],
  ['fs_sales', ['src/modules/sales-order', 'src/modules/inventory', 'src/modules/shipment']],
  ['fs_prod', ['src/modules/production', 'src/modules/quality']],
  ['fs_pur', ['src/modules/purchasing', 'src/modules/mrp', 'src/modules/message-action']],
  ['fs_msg', ['src/modules/messenger']],
  ['fs_log', ['src/modules/lot', 'src/modules/business-event', 'src/modules/dashboard']],
];
const only = process.argv.slice(2);

const admin = new pg.Client({ connectionString: `${base}/postgres` });
await admin.connect();
const existing = new Set((await admin.query('select datname from pg_database')).rows.map((r) => r.datname));
let failed = false;
for (const [db, paths] of groups) {
  if (only.length && !paths.some((p) => only.some((o) => p.includes(o)))) continue;
  const url = `${base}/${db}`;
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, TEST_DATABASE_URL: url, NODE_OPTIONS: '--experimental-vm-modules' };
  if (!existing.has(db)) {
    await admin.query(`CREATE DATABASE ${db}`);
    await admin.query(`ALTER DATABASE ${db} SET timezone='UTC'`);
  }
  execSync('npx prisma migrate deploy', { env, stdio: 'ignore' });
  const probe = new pg.Client({ connectionString: url });
  await probe.connect();
  const seeded = (await probe.query('select count(*)::int n from employee')).rows[0].n > 0;
  await probe.end();
  if (!seeded) execSync('npx tsx prisma/seed.ts', { env, stdio: 'ignore' });
  process.stdout.write(`\n── ${db}: ${paths.join(' ')}\n`);
  const r = spawnSync('npx', ['jest', '--passWithNoTests', ...paths], { env, stdio: 'inherit' });
  if (r.status !== 0) failed = true;
}
await admin.end();
process.exit(failed ? 1 : 0);
