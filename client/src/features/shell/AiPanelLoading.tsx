'use client';

// 철강맨AI 패널 조각을 불러오는 동안 같은 자리에 보이는 빈 틀 (AiPanel의 바깥 모양과 같다)
import { useShellStore } from '@/stores/useShellStore';

export function AiPanelLoading() {
  const expanded = useShellStore((state) => state.aiPanelExpanded);
  return (
    <aside
      aria-label="철강맨AI"
      aria-busy="true"
      className={`absolute inset-y-0 right-0 z-10 flex min-h-0 flex-col items-center justify-center border-l-2 border-ink bg-surface text-sm text-ink-3 shadow-[-4px_0_0_rgba(18,24,32,0.16),var(--shadow-pop)] ${expanded ? 'w-full' : 'w-[min(620px,46vw)]'}`}
    >
      철강맨AI를 불러오는 중이에요…
    </aside>
  );
}
