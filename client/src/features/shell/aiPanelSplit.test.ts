// 철강맨AI 패널(AiPanel.tsx)이 처음 화면의 공통 JS에 다시 들어가지 않게 지킨다 (이슈 #462).
// 패널은 aiPanelLoader.ts의 import()로만 불러오고, 다른 파일은 AiPanel.tsx를 정적으로 가져오지 않는다.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const rel = (path: string) => path.slice(SRC.length);
const importsAiPanel = /^\s*import\s[^;]*from\s+['"](?:@\/features\/shell\/AiPanel|\.\/AiPanel)['"]/m;

describe('철강맨AI 패널 지연 로딩', () => {
  it('AiPanel.tsx를 정적으로 import하는 파일이 없다', () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => importsAiPanel.test(readFileSync(path, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('셸 틀은 패널을 next/dynamic으로 불러오고 상단 바 단추가 미리 불러온다', () => {
    const frame = readFileSync(join(SRC, 'features/shell/AppFrame.tsx'), 'utf8');
    expect(frame).toMatch(/dynamic\(loadAiPanel,\s*\{\s*ssr:\s*false/);
    expect(readFileSync(join(SRC, 'features/shell/aiPanelLoader.ts'), 'utf8')).toContain("import('@/features/shell/AiPanel')");
    expect(readFileSync(join(SRC, 'features/shell/TopBar.tsx'), 'utf8')).toContain('loadAiPanel()');
  });

  it('패널을 닫아도 필요한 철강맨 부르기는 셸에 항상 붙어 있다 (SteelmanWake는 패널 조각이 아니다)', () => {
    const frame = readFileSync(join(SRC, 'features/shell/AppFrame.tsx'), 'utf8');
    expect(frame).toContain("import { SteelmanWake } from '@/features/shell/SteelmanWake'");
    expect(frame).toContain('<SteelmanWake />');
  });
});
