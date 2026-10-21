'use client';

// B안 셸 틀: 어두운 아이콘 레일 + 상단 바 + 본문(+ 넓은 AI 패널)
import dynamic from 'next/dynamic';
import { useCallback, useState, type ReactNode } from 'react';
import { AiPanelLoading } from '@/features/shell/AiPanelLoading';
import { loadAiPanel } from '@/features/shell/aiPanelLoader';
import { AiScreenControl } from '@/features/shell/AiScreenControl';
import { PetMount } from '@/features/shell/PetMount';
import { Rail } from '@/features/shell/Rail';
import { RouteGuard } from '@/features/shell/RouteGuard';
import { ShellTitleContext, type ShellTitle } from '@/features/shell/ShellTitleContext';
import { SteelmanWake } from '@/features/shell/SteelmanWake';
import { TopBar } from '@/features/shell/TopBar';
import { useMessengerSocket } from '@/hooks/useMessengerSocket';
import { useShellStore } from '@/stores/useShellStore';

// 패널은 여는 순간 불러온다(공통 JS에서 뺀다). 철강맨 부르기의 질문 요청은 스토어에 남아 있다가 패널이 뜬 뒤 가져간다
const AiPanel = dynamic(loadAiPanel, { ssr: false, loading: () => <AiPanelLoading /> });

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
