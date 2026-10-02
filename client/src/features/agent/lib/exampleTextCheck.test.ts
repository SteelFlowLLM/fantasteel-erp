import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectTexts, findForbiddenWords, findMalformedNumbers } from '@/features/agent/lib/exampleTextCheck';

describe('준비 중 예시 문구 점검 도우미', () => {
  it('객체 안의 문자열을 모두 모은다', () => {
    expect(collectTexts({ a: 'x', b: ['y', { c: 'z' }], d: 3, e: null })).toEqual(['x', 'y', 'z']);
  });

  it('용어 사전 금지어와 단독 SM355, AI 없는 Factory Agent를 찾는다', () => {
    expect(findForbiddenWords(['주문 품목', 'SM355 히트', 'Factory Agent 화면'])).toEqual(expect.arrayContaining(['주문', 'SM355', 'Factory Agent']));
    expect(findForbiddenWords(['AI Factory Agent', 'SM355A · SM355D', '수주 매수', '구매요청 초안'])).toEqual([]);
  });

  it('9.1·9.2 형식이 아닌 번호를 찾는다', () => {
    expect(findMalformedNumbers(['SO-2610-001 · PP-2610-0001 · EV-261001-023', 'HT-BOF1-260929-015-03 · CBOF1-260929-015-03 · RM-ORE01-260929-001'])).toEqual([]);
    expect(findMalformedNumbers(['SO-20260930-0001', 'HT-2-260929-015', 'C2-260929-015-03'])).toEqual([
      'SO-20260930-0001',
      'HT-2-260929-015',
      'C2-260929-015-03',
    ]);
  });
});

/** 화면 파일에서 주석을 뺀 코드 (화면 문구 점검용) */
function screenSourceOf(relativePath: string): string {
  const source = readFileSync(fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url)), 'utf8');
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('{/*') && !line.trim().startsWith('/**') && !line.trim().startsWith('*'))
    .join('\n');
}

describe('준비 중 화면 파일의 문구', () => {
  const screens = [
    'features/agent/AgentScreen.tsx',
    'features/agent/components/SoonExampleParts.tsx',
    'features/meetings/MeetingScreen.tsx',
    'features/pastCases/PastCaseScreen.tsx',
    'features/shell/AiPanel.tsx',
  ];

  it.each(screens)('%s: 금지어·잘못된 번호·코드 원문이 없다', (path) => {
    const source = screenSourceOf(path);
    expect(findForbiddenWords([source])).toEqual([]);
    expect(findMalformedNumbers([source])).toEqual([]);
    // 초안 상태·주체는 공통 코드 표시명으로만 보인다 (reports/6 C-2)
    expect(source).not.toMatch(/>\s*(AI_GENERATED|WAITING_APPROVAL|APPROVED|EXECUTED|SYSTEM|USER)\s*</);
    expect(source).not.toMatch(/['"`](AI_GENERATED|WAITING_APPROVAL)['"`]/);
  });
});
