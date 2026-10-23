'use client';

// 철강맨AI 입력칸의 / 명령 고르기 (이슈 #410). @ Drive 파일 고르기와 같은 자리에 뜨지만 검색칸이 따로 없다:
// 포커스는 입력칸에 두고 / 뒤 글자로 거르며, ↑↓·Enter·Tab·Esc는 입력칸(AiPanel)이 받는다.
import type { AiSlashCommand, AiSlashCommandKey } from '@/lib/aiSlashCommand';
import { slashUsage } from '@/lib/aiSlashCommand';
import { cn } from '@/lib/cn';

export const AI_SLASH_MENU_ID = 'ai-slash-command-list';
export const aiSlashOptionId = (key: AiSlashCommandKey): string => `ai-slash-command-${key}`;

export function AiSlashCommandMenu({
  commands,
  active,
  blockedReasonOf,
  onPick,
  onHover,
}: {
  commands: readonly AiSlashCommand[];
  active: number;
  blockedReasonOf: (key: AiSlashCommandKey) => string | null;
  onPick: (command: AiSlashCommand) => void;
  onHover: (index: number) => void;
}) {
  return (
    <div className="absolute right-0 bottom-full left-0 z-20 mb-1.5 flex max-h-72 flex-col rounded-md border border-line-strong bg-surface shadow-pop">
      <ul id={AI_SLASH_MENU_ID} role="listbox" aria-label="명령" className="min-h-0 flex-1 overflow-auto py-1">
        {commands.map((command, index) => {
          const blocked = blockedReasonOf(command.key);
          return (
            <li
              key={command.key}
              id={aiSlashOptionId(command.key)}
              role="option"
              aria-selected={index === active}
              aria-disabled={blocked !== null}
              className={cn('flex cursor-pointer items-baseline gap-2.5 px-3 py-1.5 text-sm', index === active ? 'bg-steelman-soft text-steelman-ink' : 'text-ink-2 hover:bg-surface-2')}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => {
                // 입력칸의 포커스를 잃기 전에 고른다
                event.preventDefault();
                onPick(command);
              }}
            >
              <span className={cn('w-28 flex-none font-semibold', blocked && 'opacity-55')}>{slashUsage(command)}</span>
              <span className={cn('min-w-0 flex-1 truncate', blocked ? 'text-ink-3' : '')}>{blocked ?? command.description}</span>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-line px-3 py-1 text-cap text-ink-3">↑↓ 고르기 · Enter·Tab 고르기 · Esc 닫기 · 명령이 아닌 글은 그대로 보내요</div>
    </div>
  );
}
