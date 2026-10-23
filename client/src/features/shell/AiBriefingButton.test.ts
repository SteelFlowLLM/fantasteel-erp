// 철강맨AI 아침 브리핑 (이슈 #506): 빈 대화 첫 화면의 [오늘 브리핑] 단추는 브리핑 질문을 보내고,
// /브리핑 명령은 로그인 때 뜨는 철강맨 아침 브리핑 창을 다시 연다.
import { AI_BRIEFING_QUESTION } from '@fantasteel/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AI_BRIEFING_BUTTON_LABEL, AiBriefingButton } from '@/features/shell/AiBriefingButton';
import { AI_SLASH_COMMANDS } from '@/lib/aiSlashCommand';

const SRC = fileURLToPath(new URL('../../', import.meta.url));

describe('[오늘 브리핑] 단추', () => {
  it('단추를 그린다: 이름이 있고, 답을 받는 중에는 눌리지 않는다', () => {
    const enabled = renderToStaticMarkup(createElement(AiBriefingButton, { disabled: false, onAsk: () => undefined }));
    expect(enabled).toContain(AI_BRIEFING_BUTTON_LABEL);
    expect(AI_BRIEFING_BUTTON_LABEL).toBe('오늘 브리핑');
    expect(enabled).not.toMatch(/<button[^>]*\sdisabled(=|\s|>)/);
    const disabled = renderToStaticMarkup(createElement(AiBriefingButton, { disabled: true, onAsk: () => undefined }));
    expect(disabled).toMatch(/<button[^>]*\sdisabled(=|\s|>)/);
  });

  it('누르면 브리핑 질문을 보낸다', () => {
    const asked: string[] = [];
    const element = AiBriefingButton({ disabled: false, onAsk: (question) => asked.push(question) }) as ReactElement<{ onClick: () => void }>;
    element.props.onClick();
    expect(asked).toEqual([AI_BRIEFING_QUESTION]);
    expect(AI_BRIEFING_QUESTION).toBe('오늘 브리핑 해 줘');
  });
});

describe('철강맨AI 패널의 브리핑 연결', () => {
  const panel = readFileSync(join(SRC, 'features/shell/AiPanel.tsx'), 'utf8');

  it('빈 대화 첫 화면(Welcome)에 단추가 있다', () => {
    expect(panel).toMatch(/function Welcome[\s\S]*<AiBriefingButton disabled=\{disabled\} onAsk=\{onAsk\} \/>/);
  });

  it('/브리핑 명령은 철강맨 아침 브리핑 창을 처음부터 다시 연다', () => {
    expect(AI_SLASH_COMMANDS.find((command) => command.key === 'briefing')?.name).toBe('브리핑');
    expect(panel).toMatch(/case 'briefing':\s*useBriefingStore\.getState\(\)\.openBriefing\(\);/);
  });

  it('브리핑 창은 대화와 따로 떠서 답을 받는 중에도 /브리핑을 쓸 수 있다', () => {
    expect(panel).toMatch(/case 'briefing':\s*return null;/);
  });
});

describe('철강맨 펫 대화창의 /브리핑', () => {
  const pet = readFileSync(join(SRC, 'features/shell/PetMount.tsx'), 'utf8');
  const engine = readFileSync(join(SRC, '../public/pet/pet-engine.js'), 'utf8');

  it('펫 대화창 /브리핑은 AI 연결과 상관없이 브리핑 창을 처음부터 다시 연다', () => {
    expect(pet).toMatch(/commands: \{\s*브리핑: \(\) => \{\s*useBriefingStore\.getState\(\)\.openBriefing\(\);/);
    // 명령은 AI로 보내기 전에 가로챈다
    expect(engine.indexOf('o.commands[word]')).toBeLessThan(engine.indexOf("const ans = answerFor(text);"));
    expect(engine).toContain('Object.prototype.hasOwnProperty.call(o.commands, word)');
  });
});
