// 용어 사전(docs/notion/03-용어-사전.md) 표와 업무 프로세스 정의서(04) 6.0 '한눈에 보기' 표를 읽어 AI 어시스턴트 업무 지식(REQ-AST-003)으로 쓸 파일을 만든다.
// 서버가 실행 중에 docs/를 읽지 않게(배포 폴더에는 docs/가 없다) 공통 코드처럼 미리 만들어 커밋한다.
// 두 문서 중 하나가 바뀌면 다시 실행한다: npm run glossary -w @fantasteel/server
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docPath = join(root, '..', 'docs', 'notion', '03-용어-사전.md');
const outPath = join(root, 'src', 'modules', 'ai-assistant', 'knowledge', 'glossary.generated.ts');

const HEADER = ['용어 ID', '구분', '한글명', '영문명', '약어', '변수명', 'DB명', '정의', '업무 규칙', '근거', '관련 용어', '동의어(사용 금지)', '비고'];

const doc = readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n');
const terms = [];
let section = null;
for (const line of doc.split('\n')) {
  const heading = line.match(/^## \d+\. (.+)$/);
  if (heading) {
    section = heading[1].trim();
    continue;
  }
  if (line.startsWith('| 용어 ID')) {
    const header = cellsOf(line);
    if (header.join('|') !== HEADER.join('|')) throw new Error(`표 머리가 다름 (${section}): ${line}`);
    continue;
  }
  if (!/^\| TRM-\d{3} \|/.test(line)) continue;
  const cells = cellsOf(line);
  if (cells.length !== HEADER.length) throw new Error(`칸 수가 ${cells.length}개 (${HEADER.length}개여야 함): ${line}`);
  const [id, kind, name, englishName, abbreviation, variableName, , definition, businessRule, , relatedTerms, forbiddenSynonyms] = cells;
  terms.push({
    id,
    section,
    kind,
    name,
    englishName: valueOf(englishName),
    abbreviation: valueOf(abbreviation),
    variableName: valueOf(variableName),
    definition,
    businessRule: valueOf(businessRule),
    relatedTerms: listOf(relatedTerms),
    forbiddenSynonyms: listOf(forbiddenSynonyms),
  });
}
if (!terms.length) throw new Error('용어를 하나도 읽지 못함');
const ids = new Set(terms.map((t) => t.id));
if (ids.size !== terms.length) throw new Error('용어 ID가 겹침');

const out = [
  '// 이 파일은 scripts/generate-glossary.mjs가 용어 사전(docs/notion/03-용어-사전.md)에서 만든다. 손으로 고치지 않는다.',
  '// 바꾸는 순서: 용어 사전 수정 → npm run glossary -w @fantasteel/server',
  "import type { GlossaryTerm } from './glossary.types';",
  '',
  `export const GLOSSARY_TERMS: readonly GlossaryTerm[] = ${JSON.stringify(terms, null, 2)};`,
  '',
];
writeFileSync(outPath, out.join('\n'), 'utf8');
process.stdout.write(`용어 ${terms.length}개 → ${outPath}\n`);

const processDocPath = join(root, '..', 'docs', 'notion', '04-업무-프로세스-정의서.md');
const processOutPath = join(root, 'src', 'modules', 'ai-assistant', 'knowledge', 'process.generated.ts');
const PROCESS_HEADER = ['업무 ID', '업무', '주체', '핵심 흐름', '결과물'];
const processDoc = readFileSync(processDocPath, 'utf8').replace(/\r\n/g, '\n');
const steps = [];
let inOverview = false;
for (const line of processDoc.split('\n')) {
  if (line.startsWith('### 6.0 ')) inOverview = true;
  else if (inOverview && line.startsWith('###')) break;
  if (!inOverview) continue;
  if (line.startsWith('| 업무 ID')) {
    const header = cellsOf(line);
    if (header.join('|') !== PROCESS_HEADER.join('|')) throw new Error(`6.0 표 머리가 다름: ${line}`);
    continue;
  }
  if (!/^\| BP-[A-Z]+-\d{2} \|/.test(line)) continue;
  const cells = cellsOf(line);
  if (cells.length !== PROCESS_HEADER.length) throw new Error(`칸 수가 ${cells.length}개 (${PROCESS_HEADER.length}개여야 함): ${line}`);
  const [id, name, actor, flow, output] = cells;
  steps.push({ id, name, actor, flow, output });
}
if (!steps.length) throw new Error('업무 프로세스를 하나도 읽지 못함');
if (new Set(steps.map((s) => s.id)).size !== steps.length) throw new Error('업무 ID가 겹침');

writeFileSync(
  processOutPath,
  [
    '// 이 파일은 scripts/generate-glossary.mjs가 업무 프로세스 정의서(docs/notion/04-업무-프로세스-정의서.md) 6.0 표에서 만든다. 손으로 고치지 않는다.',
    '// 바꾸는 순서: 업무 프로세스 정의서 수정 → npm run glossary -w @fantasteel/server',
    "import type { ProcessStep } from './process.types';",
    '',
    `export const PROCESS_STEPS: readonly ProcessStep[] = ${JSON.stringify(steps, null, 2)};`,
    '',
  ].join('\n'),
  'utf8',
);
process.stdout.write(`업무 프로세스 ${steps.length}개 → ${processOutPath}\n`);

function cellsOf(line) {
  return line.split('|').slice(1, -1).map((c) => c.trim());
}

/** '-'·빈 칸은 값 없음. 변수명 칸의 `item` / `itemCode`는 `를 뗀다 */
function valueOf(cell) {
  const value = cell.replace(/`/g, '').trim();
  return value === '' || value === '-' ? null : value;
}

/** 쉼표로 나누되 괄호 안 쉼표는 나누지 않는다 (예: HOLD(불합격 상태의 값 '보류'로만 사용, 별도 개념 아님)) */
function listOf(cell) {
  const value = valueOf(cell);
  if (value === null) return [];
  const items = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      items.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  items.push(current);
  return items.map((v) => v.trim()).filter((v) => v && v !== '-');
}
