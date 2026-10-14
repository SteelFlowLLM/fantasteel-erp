'use client';

// 통합 검색: 수주번호·LOT 번호·출하요청 번호를 입력하면 결과를 보이고, 누르거나 Enter로 그 화면에 간다.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { canListSalesOrders, canListShipmentRequests } from '@/api/search';
import { Icon } from '@/components/Icon';
import { Tag } from '@/components/Tag';
import { PopItem, PopList, PopNote, PopPanel } from '@/features/shell/PopPanel';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { useMe } from '@/hooks/useMe';
import { usePopover } from '@/hooks/usePopover';
import type { PermissionMap } from '@/lib/permissions';

/** 결과가 없을 때 덧붙이는 안내: LOT은 앞에서부터 찾고, 조회 권한이 없는 수주·출하요청은 찾지 않는다 (api/server/search.ts) */
export function emptyHint(user: { permissions: PermissionMap }): string {
  const hidden = [canListSalesOrders(user) ? null : '수주', canListShipmentRequests(user) ? null : '출하요청'].filter((kind): kind is string => kind !== null);
  const lotRule = 'LOT 번호는 앞에서부터 입력해 주세요';
  return hidden.length ? `${lotRule} · ${hidden.join('·')} 번호는 조회 권한이 있어야 찾을 수 있어요` : lotRule;
}

export function SearchBox() {
  const me = useMe();
  const [keyword, setKeyword] = useState('');
  const popover = usePopover<HTMLDivElement>();
  const router = useRouter();
  const search = useGlobalSearch(keyword);

  const go = (href: string) => {
    popover.setOpen(false);
    setKeyword('');
    router.push(href);
  };

  return (
    <div ref={popover.ref} data-pet-target="topbar:search" className="relative w-[min(460px,32vw)] min-w-[200px]">
      <label className="flex h-[34px] items-center gap-2 rounded-sm border border-line-strong bg-surface-2 px-2.5 text-ink-3 focus-within:border-run focus-within:shadow-[0_0_0_2px_var(--color-run-bg)]">
        <Icon name="search" />
        <input
          type="search"
          value={keyword}
          placeholder="수주번호·LOT 번호·출하요청 번호 검색"
          aria-label="통합 검색"
          className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
          onChange={(event) => {
            setKeyword(event.target.value);
            popover.setOpen(true);
          }}
          onFocus={() => {
            if (keyword.trim()) popover.setOpen(true);
          }}
          onKeyDown={(event) => {
            const first = search.items[0];
            if (event.key === 'Enter' && first) go(first.href);
          }}
        />
      </label>
      {popover.open && search.isActive ? (
        <PopPanel label="검색 결과" role="listbox" placement="stretch">
          <PopList>
            {search.items.map((hit) => (
              <PopItem key={`${hit.kind}-${hit.href}`} role="option" aria-selected="false" centered onClick={() => go(hit.href)}>
                <Tag className="flex-none">{hit.kindLabel}</Tag>
                <span className="min-w-0 truncate font-mono text-mono">{hit.label}</span>
              </PopItem>
            ))}
            {!search.items.length ? (
              <PopNote>
                {search.isSearching ? (
                  '찾는 중…'
                ) : (
                  <>
                    일치하는 번호가 없어요
                    {/* 권한이 없어 빠진 목록과 LOT 앞부분 일치 규칙을 말해 준다: "없어요"만 보이면 번호가 없는 줄 알았다 */}
                    <span className="mt-1 block">{emptyHint(me)}</span>
                  </>
                )}
              </PopNote>
            ) : null}
          </PopList>
        </PopPanel>
      ) : null}
    </div>
  );
}
