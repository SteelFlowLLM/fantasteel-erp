// 공통 코드 정의서(docs/notion/06-공통-코드-정의서.md) 2장 "확정 코드" 표를 읽어 src/codes/index.ts를 만든다.
// 정의서가 바뀌면 이 스크립트를 다시 실행한다: npm run codes -w @fantasteel/shared
// 3장 "제안 코드(팀 확정 필요)"는 확정되어 2장으로 옮겨진 뒤에만 들어간다.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docPath = join(root, '..', 'docs', 'notion', '06-공통-코드-정의서.md');
const outPath = join(root, 'src', 'codes', 'index.ts');

// 기준정보 테이블로 관리하는 그룹은 상수로 만들지 않는다 (정의서 4장: 강종은 테이블, 2장 표는 초기 시드)
const SKIP = new Set(['STEEL_GRADE']);

const doc = readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n');
const confirmed = doc.slice(doc.indexOf('## 2.'), doc.indexOf('## 3.'));

const groups = [];
for (const section of confirmed.split(/^### /m).slice(1)) {
  const [head, ...rest] = section.split('\n');
  const m = head.match(/^([A-Z_]+) · (.+)$/);
  if (!m) throw new Error(`코드 그룹 제목을 읽지 못함: ${head}`);
  const [, id, title] = m;
  if (SKIP.has(id)) continue;
  const body = rest.join('\n');
  const basis = body.match(/^근거: ([^\n.]+)/m)?.[1]?.trim();
  const rows = body.split('\n').filter((l) => /^\| [A-Z][A-Z0-9_]* \|/.test(l)).map((l) => l.split('|').map((c) => c.trim()));
  if (!rows.length) throw new Error(`${id}: 값 표가 없음`);
  groups.push({ id, title, basis, values: rows.map((r) => ({ value: r[1], label: r[2] })) });
}

const typeName = (id) => id.toLowerCase().replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase());
const out = [
  '// 이 파일은 scripts/generate-codes.mjs가 공통 코드 정의서 2장에서 만든다. 손으로 고치지 않는다.',
  '// 바꾸는 순서: 공통 코드 정의서 수정 → npm run codes -w @fantasteel/shared → 필요하면 CHECK 제약 마이그레이션',
  '',
];
for (const g of groups) {
  const t = typeName(g.id);
  out.push(`/** ${g.title}${g.basis ? ` (${g.basis})` : ''} */`);
  out.push(`export const ${g.id} = {`);
  for (const v of g.values) out.push(`  ${v.value}: '${v.value}',`);
  out.push('} as const;');
  out.push(`export type ${t} = (typeof ${g.id})[keyof typeof ${g.id}];`);
  out.push(`export const ${g.id}_LABEL: Record<${t}, string> = {`);
  for (const v of g.values) out.push(`  ${v.value}: '${v.label.replace(/'/g, "\\'")}',`);
  out.push('};');
  out.push('');
}
writeFileSync(outPath, out.join('\n'));
process.stdout.write(`코드 그룹 ${groups.length}개 → ${outPath}\n`);
