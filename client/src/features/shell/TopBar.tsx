'use client';

// B안 상단 바 (52px): 제목과 "{영역} · MM-DD (요일) HH:mm", 통합 검색, AI 어시스턴트 버튼, 알림·메신저, 사용자 메뉴
import { usePathname } from 'next/navigation';
import { AiMark } from '@/components/ComingSoon';
import { MessengerMenu } from '@/features/shell/MessengerMenu';
import { NotificationMenu } from '@/features/shell/NotificationMenu';
import { routeTitleOf } from '@/features/shell/routeTitles';
import { SearchBox } from '@/features/shell/SearchBox';
import type { ShellTitle } from '@/features/shell/ShellTitleContext';
import { UserMenu } from '@/features/shell/UserMenu';
import { useClock } from '@/hooks/useClock';
import { useMe } from '@/hooks/useMe';
import { fmtHM, fmtMDdow } from '@/lib/format';
import { useShellStore } from '@/stores/useShellStore';

export function TopBar({ custom }: { custom: ShellTitle }) {
  const me = useMe();
  const pathname = usePathname();
  const now = useClock();
  const aiPanelOpen = useShellStore((state) => state.aiPanelOpen);
  const toggleAiPanel = useShellStore((state) => state.toggleAiPanel);
  const base = routeTitleOf(pathname);
  const title = custom.title ?? base.title;

  return (
    <header className="flex h-[52px] flex-none items-center gap-3 border-b border-line bg-surface px-4">
      <div className="flex min-w-[220px] flex-col leading-[18px]">
        <small className="text-cap text-ink-3 tabular-nums">
          {base.area ? `${base.area} · ` : ''}
          {fmtMDdow(now)} {fmtHM(now)}
          {custom.subtitle ? ` · ${custom.subtitle}` : ''}
        </small>
        <b className="text-lg leading-[18px] font-semibold">{title}</b>
      </div>
      <SearchBox />
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          aria-label="AI 어시스턴트 열기 (준비 중, P2)"
          aria-expanded={aiPanelOpen}
          onClick={toggleAiPanel}
          className="mr-1 inline-flex h-8 items-center gap-1.5 rounded-2xl border border-ai-line bg-ai-bg pr-2.5 pl-1.5 text-xs font-semibold text-ai-strong hover:bg-[#e9e3fb]"
        >
          <AiMark size="sm" />
          AI 어시스턴트
        </button>
        <NotificationMenu employeeId={me.employeeId} />
        <MessengerMenu employeeId={me.employeeId} />
        <UserMenu />
      </div>
    </header>
  );
}
