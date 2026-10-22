// 철강맨AI 아침 브리핑 (이슈 #506): 빈 대화 첫 화면의 [오늘 브리핑] 단추와 /브리핑 명령이 같은 질문을 보낸다.
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

  it('/브리핑 명령은 단추와 같은 질문을 입력칸 첨부 없이 보낸다', () => {
    expect(AI_SLASH_COMMANDS.find((command) => command.key === 'briefing')?.name).toBe('브리핑');
    expect(panel).toMatch(/case 'briefing':\s*send\(AI_BRIEFING_QUESTION, false\);/);
  });

  it('답을 받는 중에는 /브리핑을 쓸 수 없다고 입력칸 아래에 알린다', () => {
    expect(panel).toMatch(/case 'briefing':\s*return pending \? SLASH_BRIEFING_PENDING : null;/);
  });
});
