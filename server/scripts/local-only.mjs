// 로컬 DB에서만 돌리는 명령(마이그레이션 만들기·시드)을 감싼다. 공용 DB(Supabase)를 가리키면 실행하지 않는다 (SERVER-GUIDE 8장).
// migrate dev는 스키마 차이가 있으면 DB 초기화를 권하고, 시드는 화면에서 바꾼 조직·기준정보를 시드 값으로 되돌린다.
//   node scripts/local-only.mjs prisma migrate dev
import { spawnSync } from 'node:child_process';
import { describeDatabase, remoteUrl } from './db-target.mjs';

const command = process.argv.slice(2);
if (remoteUrl) {
  process.stderr.write(`[db] 공용 DB(${describeDatabase(remoteUrl)})를 가리키고 있어 실행하지 않습니다: ${command.join(' ')}\n`);
  process.stderr.write('[db] 공용 DB 반영은 DB 담당자가 npm run db:deploy -w @fantasteel/server 로 합니다 (SERVER-GUIDE 8장)\n');
  process.exit(1);
}
// Windows에서는 npx가 npx.cmd라 shell로 실행해야 한다
const r = spawnSync('npx', command, { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
