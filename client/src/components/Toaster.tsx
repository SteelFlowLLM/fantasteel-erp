'use client';

// 토스트 표시 자리 (화면 아래 가운데). 내용은 useToastStore의 toast.ok/info/error로 넣는다.
import { cn } from '@/lib/cn';
import { useToastStore } from '@/stores/useToastStore';

export function Toaster() {
  const items = useToastStore((state) => state.items);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-5 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          role={item.kind === 'error' ? 'alert' : 'status'}
          className={cn(
            'max-w-[640px] rounded-md px-4 py-2.5 text-sm text-white shadow-pop',
            item.kind === 'ok' && 'bg-ok',
            item.kind === 'error' && 'bg-danger',
            item.kind === 'info' && 'bg-nav-dark',
          )}
        >
          {item.text}
        </div>
      ))}
    </div>
  );
}
