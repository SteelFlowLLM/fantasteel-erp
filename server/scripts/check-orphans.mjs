// 고아 데이터 점검 (코드 컨벤션 7-2 [강제]: 시드 후와 PR 전에 실행).
// DB 외래키가 없으므로(relationMode = "prisma") schema.prisma의 관계마다 "가리키는 행이 없는 참조"를 센다.
//   npm run check-orphans -w @fantasteel/server
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'schema.prisma');
const schema = readFileSync(schemaPath, 'utf8');

// 모델 이름 → 테이블 이름, 필드 이름 → 컬럼 이름
const models = new Map();
for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  const columns = new Map();
  for (const line of m[2].split('\n')) {
    const f = line.match(/^\s+(\w+)\s+\w+\??\s.*?@map\("(\w+)"\)/);
    if (f) columns.set(f[1], f[2]);
    else {
      const plain = line.match(/^\s+(\w+)\s+(Int|String|Boolean|DateTime|Decimal|Json)\??(\s|$)/);
      if (plain) columns.set(plain[1], plain[1]);
    }
  }
  models.set(m[1], { table: m[2].match(/@@map\("(\w+)"\)/)?.[1] ?? m[1], columns, body: m[2] });
}

const checks = [];
for (const [, model] of models) {
  for (const r of model.body.matchAll(/^\s+\w+ (\w+)\??\s+@relation\("\w+", fields: \[(\w+)\], references: \[id\]/gm)) {
    const parent = models.get(r[1]);
    checks.push({ child: model.table, column: model.columns.get(r[2]), parent: parent.table });
  }
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:54322/fantasteel' });
await client.connect();
let orphans = 0;
for (const c of checks) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM "${c.child}" c WHERE c."${c.column}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${c.parent}" p WHERE p.id = c."${c.column}")`,
  );
  if (rows[0].n > 0) {
    orphans += rows[0].n;
    process.stdout.write(`고아 ${rows[0].n}행: ${c.child}.${c.column} → ${c.parent}.id\n`);
  }
}
await client.end();
process.stdout.write(`관계 ${checks.length}개 점검, 고아 데이터 ${orphans}행\n`);
process.exit(orphans > 0 ? 1 : 0);
