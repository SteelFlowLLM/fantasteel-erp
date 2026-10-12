'use client';

// 품질 상세 머리의 더보기(⋯) 메뉴: 과거 사례(EX)처럼 아직 준비 중인 동작을 모은다.
// 동작하는 버튼(검사 결과·LOT 추적)과 같은 줄에 나란히 두면 눌러도 안 되는 버튼이 먼저 눈에 띄어 메뉴 안으로 넣는다 (검사 기준의 '기준 삭제'와 같은 자리).
import { useRouter } from 'next/navigation';
import { ComingSoon } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { PopItem, PopPanel } from '@/features/shell/PopPanel';
import { usePopover } from '@/hooks/usePopover';

/** 메뉴 한 줄: 누르면 과거 사례 화면(디자인 미리 보기)으로 간다 (REQ-CASE-002·004) */
export interface ComingSoonMenuItem {
  label: string;
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
                router.push('/past-cases');
              }}
            >
              <Icon name="search" size="sm" />
              {item.label} <ComingSoon grade="EX" />
            </PopItem>
          ))}
        </PopPanel>
      ) : null}
    </div>
  );
}
