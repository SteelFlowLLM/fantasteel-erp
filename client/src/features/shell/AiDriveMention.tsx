'use client';

// 철강맨AI 입력칸의 @ Drive 파일 고르기 (이슈 #398 2단계). 입력칸에서 @를 치면 열리고, 고른 파일은 글이 아니라 입력칸 위 칩으로 붙는다.
// 메신저 입력칸의 @(사람 부르기)와는 따로다: 이 창은 철강맨AI 패널에서만 연다.
import type { DriveFileView } from '@fantasteel/shared';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { useDriveFiles } from '@/hooks/useIntegrations';
import { filterMentionFiles, moveMentionIndex } from '@/lib/aiDrive';
import { cn } from '@/lib/cn';

const KIND_ICON: Record<DriveFileView['kind'], IconName> = { document: 'file', image: 'file', audio: 'file' };
const KIND_LABEL: Record<DriveFileView['kind'], string> = { document: '문서', image: '사진', audio: '녹음' };

export function AiDriveMention({
  onPick,
  onClose,
  onCancel,
  onDismiss,
}: {
  onPick: (file: DriveFileView) => void;
  /** Esc: 창만 닫고 입력칸으로 돌아간다 */
  onClose: () => void;
  /** 빈 검색칸에서 지우기: 입력칸의 @까지 지운다 */
  onCancel: () => void;
  /** 창 밖을 눌렀다: 누른 곳의 포커스를 빼앗지 않고 닫기만 한다 */
  onDismiss: () => void;
}) {
  const files = useDriveFiles('all', true);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => filterMentionFiles(files.data?.pages[0]?.files ?? [], query), [files.data, query]);
  const current = Math.min(active, Math.max(0, shown.length - 1));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !boxRef.current?.contains(event.target)) onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onDismiss]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(moveMentionIndex(current, event.key === 'ArrowDown' ? 1 : -1, shown.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const file = shown[current];
      if (file) onPick(file);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Backspace' && query === '') {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div ref={boxRef} role="dialog" aria-label="Drive 파일 붙이기" className="absolute right-0 bottom-full left-0 z-20 mb-1.5 flex max-h-72 flex-col rounded-md border border-line-strong bg-surface shadow-pop">
      <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5">
        <Icon name="search" size="sm" className="text-ink-3" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Drive 파일 이름으로 찾기"
          aria-label="Drive 파일 이름으로 찾기"
          aria-controls="ai-drive-mention-list"
          aria-activedescendant={shown[current] ? `ai-drive-mention-${shown[current].id}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        <span className="flex-none text-cap text-ink-3">↑↓ 고르기 · Enter 붙이기 · Esc 닫기</span>
      </div>
      <ul id="ai-drive-mention-list" role="listbox" aria-label="Drive 파일" className="min-h-0 flex-1 overflow-auto py-1">
        {files.isPending ? <li className="px-3 py-2 text-cap text-ink-3">Drive 파일을 불러오고 있어요…</li> : null}
        {files.isError ? <li className="px-3 py-2 text-cap text-danger">Drive 파일을 불러오지 못했어요</li> : null}
        {!files.isPending && !files.isError && shown.length === 0 ? <li className="px-3 py-2 text-cap text-ink-3">맞는 파일이 없어요 (최근 50개 안에서 찾아요)</li> : null}
        {shown.map((file, index) => (
          <li
            key={file.id}
            id={`ai-drive-mention-${file.id}`}
            role="option"
            aria-selected={index === current}
            className={cn('flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm', index === current ? 'bg-steelman-soft text-steelman-ink' : 'text-ink-2 hover:bg-surface-2')}
            onMouseEnter={() => setActive(index)}
            onMouseDown={(event) => {
              // 입력칸의 포커스를 잃기 전에 고른다
              event.preventDefault();
              onPick(file);
            }}
          >
            <Icon name={KIND_ICON[file.kind]} size="sm" className="flex-none text-ink-3" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <span className="flex-none text-cap text-ink-3">{KIND_LABEL[file.kind]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
