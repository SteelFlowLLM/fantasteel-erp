'use client';

// 품질 상세 머리의 더보기(⋯) 메뉴: 과거 사례(EX) 동작을 모은다 (REQ-CASE-002 사례로 등록, REQ-CASE-004 비슷한 사례 찾기).
// 자주 쓰지 않는 동작이라 검사 결과·LOT 추적 버튼과 같은 줄에 늘어놓지 않고 메뉴 안에 넣는다 (검사 기준의 '기준 삭제'와 같은 자리).
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { PopItem, PopPanel } from '@/features/shell/PopPanel';
import { usePopover } from '@/hooks/usePopover';

/** 메뉴 한 줄: href면 그 화면으로, onSelect면 그 동작. disabledReason이 있으면 막고 이유를 보인다 */
export interface PastCaseMenuItem {
  label: string;
  icon: IconName;
  href?: string;
  onSelect?: () => void;
  disabledReason?: string;
}

export function PastCaseMenu({ items }: { items: readonly PastCaseMenuItem[] }) {
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
              disabled={Boolean(item.disabledReason)}
              title={item.disabledReason}
              onClick={() => {
                if (item.disabledReason) return;
                more.setOpen(false);
                if (item.onSelect) item.onSelect();
                else if (item.href) router.push(item.href);
              }}
            >
              <Icon name={item.icon} size="sm" />
              {item.label}
            </PopItem>
          ))}
        </PopPanel>
      ) : null}
    </div>
  );
}
