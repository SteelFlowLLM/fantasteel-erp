'use client';

// 통합 검색: 수주번호·LOT 번호·출하요청 번호를 입력하면 결과를 보이고, 누르거나 Enter로 그 화면에 간다.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Tag } from '@/components/Tag';
import { PopItem, PopList, PopNote, PopPanel } from '@/features/shell/PopPanel';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { usePopover } from '@/hooks/usePopover';

export function SearchBox() {
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
    <div ref={popover.ref} className="relative w-[min(460px,32vw)] min-w-[200px]">
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
            {!search.items.length ? <PopNote>{search.isSearching ? '찾는 중…' : '일치하는 번호가 없어요'}</PopNote> : null}
          </PopList>
        </PopPanel>
      ) : null}
    </div>
  );
}
