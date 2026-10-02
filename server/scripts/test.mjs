// 서버 테스트 실행기. 실제 DB를 쓰는 테스트가 서로 데이터를 건드리지 않도록 묶음마다 전용 DB(fs_*)를 쓴다.
// 로컬 PostgreSQL(npm run db)이 떠 있어야 한다. 개발용 DB(fantasteel)는 건드리지 않는다.
//   npm test                       ← 전체
//   npm test -- sales-order        ← 경로에 이 이름이 들어간 묶음만
//   npm run test:unit              ← DB 없이 src/common 단위 테스트만
import { execSync, spawnSync } from 'node:child_process';
import pg from 'pg';

const base = 'postgresql://postgres:postgres@localhost:54322';
const groups = [
  ['fs_common', ['src/common', 'src/modules/auth', 'src/modules/organization']],
  ['fs_master', ['src/modules/master-data']],
  ['fs_sales', ['src/modules/sales-order', 'src/modules/inventory', 'src/modules/shipment']],
  ['fs_prod', ['src/modules/production', 'src/modules/mrp', 'src/modules/quality']],
  ['fs_pur', ['src/modules/purchasing', 'src/modules/message-action']],
  ['fs_collab', ['src/modules/messenger', 'src/modules/notification']],
  ['fs_log', ['src/modules/lot', 'src/modules/business-event']],
];
const only = process.argv.slice(2).filter((a) => a !== '--unit');
// Windows에서는 npx가 npx.cmd라 shell로 실행해야 한다
const shell = process.platform === 'win32';
// NestJS 12가 ESM 패키지라 Jest(CommonJS)에서 불러오려면 이 옵션이 필요하다
const nodeOptions = [process.env.NODE_OPTIONS, '--experimental-vm-modules'].filter(Boolean).join(' ');

if (process.argv.includes('--unit')) {
  const r = spawnSync('npx', ['jest', 'src/common'], { env: { ...process.env, NODE_OPTIONS: nodeOptions }, stdio: 'inherit', shell });
  process.exit(r.status ?? 1);
}

const admin = new pg.Client({ connectionString: `${base}/postgres` });
await admin.connect();
let failed = false;
for (const [db, paths] of groups) {
  if (only.length && !paths.some((p) => only.some((o) => p.includes(o)))) continue;
  const url = `${base}/${db}`;
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, NODE_OPTIONS: nodeOptions };
  // 테스트 전용 DB는 매번 새로 만든다 (이전 실행의 데이터·옛 마이그레이션 기록이 남지 않게)
  await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [db]);
  await admin.query(`DROP DATABASE IF EXISTS ${db}`);
  await admin.query(`CREATE DATABASE ${db}`);
  await admin.query(`ALTER DATABASE ${db} SET timezone='UTC'`);
  execSync('npx prisma migrate deploy', { env, stdio: 'ignore' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'ignore' });
  process.stdout.write(`\n── ${db}: ${paths.join(' ')}\n`);
  // 같은 묶음의 파일들이 한 DB를 동시에 쓰면 채번(최댓값 + 1)이 겹쳐 unique 위반이 나므로 파일을 차례로 돌린다
  const r = spawnSync('npx', ['jest', '--passWithNoTests', '--runInBand', ...paths], { env, stdio: 'inherit', shell });
  if (r.status !== 0) failed = true;
}
await admin.end();
process.exit(failed ? 1 : 0);
