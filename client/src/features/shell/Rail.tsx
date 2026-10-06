'use client';

// B안 어두운 아이콘 레일 (72px). 메뉴는 navigation.ts에서 역할·권한·부서장 여부로 정한다.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { CountBadge } from '@/components/Badge';
import { soonLabel } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { activeNavHref, buildNavigation } from '@/features/shell/navigation';
import { Logo } from '@/features/shell/Logo';
import { useNavBadges } from '@/features/shell/useNavBadges';
import { useMe } from '@/hooks/useMe';
import { cn } from '@/lib/cn';

export function Rail() {
  const me = useMe();
  const pathname = usePathname();
  const entries = useMemo(() => buildNavigation(me), [me]);
  const active = activeNavHref(entries, pathname);
  const badges = useNavBadges(me);

  return (
    <nav
      aria-label="주 메뉴"
      // 조회 권한 화면까지 붙으면 레일이 길어진다(관리자는 모든 화면). 세로로 스크롤하고, 얇은 막대로 스크롤할 수 있음을 보인다.
      className="flex w-[72px] flex-none flex-col items-center gap-0.5 overflow-y-auto overscroll-contain bg-nav-dark py-2.5 text-nav-ink [scrollbar-color:#2e3d4e_transparent] [scrollbar-width:thin]"
    >
      <Link href="/dashboard" aria-label="FantaSteel 대시보드" className="mb-2.5 flex size-10 flex-none items-center justify-center">
        <Logo />
      </Link>
      {entries.map((entry) => {
        if (entry.kind === 'separator') return <span key={entry.key} aria-hidden="true" className="my-1.5 h-px w-9 flex-none bg-[#2e3d4e]" />;
        const isActive = entry.href === active;
        const badge = entry.badge ? badges[entry.badge] : 0;
        const hint = entry.soon ? `${entry.label} · ${soonLabel(entry.soon)}` : entry.label;
        return (
          <Link
            key={entry.href}
            href={entry.href}
            title={hint}
            aria-label={entry.soon ? hint : undefined}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative flex w-[60px] flex-none flex-col items-center gap-[3px] rounded-md pt-[7px] pb-1.5 text-center text-2xs leading-tight font-medium break-keep [&_.ic]:size-5',
              isActive ? 'bg-nav-dark-2 text-white [&_.ic]:text-[#8fb4e0]' : 'text-nav-ink hover:bg-nav-dark-2',
            )}
          >
            <Icon name={entry.icon} />
            <span>{entry.label}</span>
            {entry.soon ? (
              <span className="absolute top-[3px] right-[9px] rounded-[3px] bg-[#2e3d4e] px-[3px] text-[8.5px] leading-[11px] font-semibold text-[#a9b6c4]">{entry.soon}</span>
            ) : null}
            <CountBadge count={badge} placement="rail" />
          </Link>
        );
      })}
    </nav>
  );
}
