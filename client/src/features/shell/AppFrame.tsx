'use client';

// B안 셸 틀: 어두운 아이콘 레일 + 상단 바 + 본문(+ 넓은 AI 패널)
import { useCallback, useState, type ReactNode } from 'react';
import { AiPanel } from '@/features/shell/AiPanel';
import { AiScreenControl } from '@/features/shell/AiScreenControl';
import { PetMount } from '@/features/shell/PetMount';
import { Rail } from '@/features/shell/Rail';
import { RouteGuard } from '@/features/shell/RouteGuard';
import { ShellTitleContext, type ShellTitle } from '@/features/shell/ShellTitleContext';
import { SteelmanWake } from '@/features/shell/SteelmanWake';
import { TopBar } from '@/features/shell/TopBar';
import { useMessengerSocket } from '@/hooks/useMessengerSocket';
import { useShellStore } from '@/stores/useShellStore';

export function AppFrame({ children }: { children: ReactNode }) {
  const aiPanelOpen = useShellStore((state) => state.aiPanelOpen);
  const [custom, setCustom] = useState<ShellTitle>({});
  const setTitle = useCallback((title: ShellTitle) => setCustom(title), []);
  useMessengerSocket();

  return (
    <div className="flex h-viewport w-viewport overflow-hidden bg-bg">
      <Rail />
      {/* 철강맨AI의 화면 캡처 영역 (lib/aiCapture.ts): 레일을 뺀 상단 바와 본문 */}
      <div data-ai-capture="" className="flex min-w-0 flex-1 flex-col">
        <SteelmanWake />
        <AiScreenControl />
        <TopBar custom={custom} />
        <div className="relative flex min-h-0 flex-1">
          <ShellTitleContext.Provider value={setTitle}>
            <RouteGuard>{children}</RouteGuard>
          </ShellTitleContext.Provider>
          {aiPanelOpen ? <AiPanel /> : null}
        </div>
      </div>
      <PetMount />
    </div>
  );
}
