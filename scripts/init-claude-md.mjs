// npm install 때 실행: CLAUDE.md가 없으면 초안(CLAUDE.template.md)을 복사해 만든다.
// CLAUDE.md는 각자의 파일이라 git에 올리지 않는다(.gitignore). 이미 있으면 건드리지 않는다.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'CLAUDE.md');
const template = join(root, 'CLAUDE.template.md');

if (!existsSync(target) && existsSync(template)) {
  copyFileSync(template, target);
  process.stdout.write('[claude] CLAUDE.template.md를 복사해 CLAUDE.md를 만들었습니다 (git에 올라가지 않는 개인 파일)\n');
}
