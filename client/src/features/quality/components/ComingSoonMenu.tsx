'use client';

// 품질 상세 머리의 더보기(⋯) 메뉴: 과거 사례(EX) 동작을 모은다.
// 동작하는 버튼(검사 결과·LOT 추적)과 같은 줄에 나란히 두면 눌러도 안 되는 버튼이 먼저 눈에 띄어 메뉴 안으로 넣는다 (검사 기준의 '기준 삭제'와 같은 자리).
import { useRouter } from 'next/navigation';
import { ComingSoon } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { PopItem, PopPanel } from '@/features/shell/PopPanel';
import { usePopover } from '@/hooks/usePopover';

/**
 * 메뉴 한 줄 (REQ-CASE-002·004).
 * href가 있으면 동작하는 항목(비슷한 사례 찾기 → 검색어를 넣어 과거 사례 화면), 없으면 준비 중 표시를 붙여 과거 사례 화면으로 간다(사례로 등록).
 */
export interface ComingSoonMenuItem {
  label: string;
  href?: string;
}

export function ComingSoonMenu({ items }: { items: readonly ComingSoonMenuItem[] }) {
  const more = usePopover<HTMLDivElement>();
  const router = useRouter();
  return (
    <div ref={more.ref} className="relative">
      <IconButton icon="more" label="더보기" aria-haspopup="menu" aria-expanded={more.open} onClick={() => more.setOpen(!more.open)} />
      {more.open ? (
        <PopPanel label="더보기" role="menu" placement="right-narrow">
          {items.map((item) => (
            <PopItem
              key={item.label}
              role="menuitem"
              onClick={() => {
                more.setOpen(false);
                router.push(item.href ?? '/past-cases');
              }}
            >
              <Icon name="search" size="sm" />
              {item.label} {item.href ? null : <ComingSoon grade="EX" />}
            </PopItem>
          ))}
        </PopPanel>
      ) : null}
    </div>
  );
}
