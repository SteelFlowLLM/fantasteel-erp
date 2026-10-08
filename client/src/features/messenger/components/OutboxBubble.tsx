'use client';

// 아직 저장되지 않은 내 메시지: 보내는 중(흐리게) · 전송 실패(이유 + 다시 보내기·삭제). 내 메시지처럼 오른쪽 말풍선.
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { EmoticonImage } from '@/features/messenger/components/Emoticon';
import { cn } from '@/lib/cn';
import type { OutboxItem } from '@/stores/useOutboxStore';

export function OutboxBubble({ item, onRetry, onDiscard }: { item: OutboxItem; onRetry: () => void; onDiscard: () => void }) {
  const failed = item.status === 'failed';
  const { content, files = [], emoticonKey } = item.input;
  return (
    <div className="flex justify-end px-5 pt-2 pb-1" aria-live="polite">
      <div className="flex max-w-[70%] min-w-0 flex-col items-end gap-1">
        {emoticonKey ? <EmoticonImage emoticonKey={emoticonKey} className={failed ? undefined : 'opacity-60'} /> : null}
        {content ? (
          <p
            className={cn(
              'max-w-full rounded-lg rounded-br-xs px-3 py-2 text-sm leading-normal break-words whitespace-pre-wrap',
              failed ? 'border border-danger bg-surface text-ink' : 'bg-brand text-on-brand opacity-60',
            )}
          >
            {content}
          </p>
        ) : null}
        {files.map((file, index) => (
          <span key={`${index}-${file.name}`} className={cn('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs', failed ? 'border-danger' : 'border-line opacity-60')}>
            <Icon name="clip" size="sm" className="text-ink-3" />
            <span className="max-w-[240px] truncate">{file.name}</span>
          </span>
        ))}
        {failed ? (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <span className="text-cap text-danger" role="alert">
              전송 실패{item.errorText ? ` · ${item.errorText}` : ''}
            </span>
            <Button size="sm" variant="ghost" icon="refresh" onClick={onRetry}>
              다시 보내기
            </Button>
            <Button size="sm" variant="ghost" onClick={onDiscard}>
              삭제
            </Button>
          </div>
        ) : (
          <span className="text-cap text-ink-3">보내는 중…</span>
        )}
      </div>
    </div>
  );
}
