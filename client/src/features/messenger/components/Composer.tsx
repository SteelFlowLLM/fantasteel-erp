'use client';

// 메시지 입력창: 글 + 파일 1개(REQ-MSG-003), @멘션 고르기(REQ-MSG-005). Enter 보내기 · Shift+Enter 줄바꿈.
import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { MESSAGE_CONTENT_MAX, MESSAGE_FILE_MAX_BYTES, messengerApi, type ChatRoomDetailView } from '@/api/messenger';
import type { MentionTarget } from '@/api/messengerRules';
import { Button } from '@/components/Button';
import { SoonButton, soonLabel } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useAction } from '@/hooks/useAction';
import { cn } from '@/lib/cn';
import { fmtBytes } from '@/lib/format';
import { toast } from '@/stores/useToastStore';

const MAX_LINES = 6;
const MAX_CANDIDATES = 8;
const FILE_LIMIT_TEXT = MESSAGE_FILE_MAX_BYTES >= 1024 * 1024 ? `${Math.round(MESSAGE_FILE_MAX_BYTES / 1024 / 1024)}MB` : `${Math.round(MESSAGE_FILE_MAX_BYTES / 1024)}KB`;

interface MentionState {
  /** '@' 자리 */
  start: number;
  query: string;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('파일을 읽지 못했어요. 다시 골라 주세요'));
    reader.readAsDataURL(file);
  });
}

/** 커서 바로 앞의 '@검색어' (공백 없이 이어진 것) */
function mentionAt(text: string, caret: number): MentionState | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query) || query.length > 20) return null;
  return { start: at, query };
}

export function Composer({ room, onSent }: { room: ChatRoomDetailView; onSent: () => void }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reading, setReading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const send = useAction(messengerApi.sendMessage, {
    onSuccess: () => {
      setText('');
      setFile(null);
      onSent();
    },
  });
  const pending = send.isPending || reading;

  const candidates = useMemo<MentionTarget[]>(() => {
    if (!mention) return [];
    const query = mention.query.toLowerCase();
    return room.mentionTargets.filter((target) => target.name.toLowerCase().includes(query)).slice(0, MAX_CANDIDATES);
  }, [mention, room.mentionTargets]);

  const updateMention = (value: string, caret: number) => {
    const next = mentionAt(value, caret);
    setMention(next);
    setActiveIndex(0);
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setText(event.target.value);
    updateMention(event.target.value, event.target.selectionStart);
  };

  const insertMention = (target: MentionTarget) => {
    if (!mention) return;
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${target.name} ${text.slice(caret)}`;
    setText(next);
    setMention(null);
    const position = mention.start + target.name.length + 2;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(position, position);
    });
  };

  const startMention = () => {
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? text.length;
    const needsSpace = caret > 0 && !/\s/.test(text[caret - 1] ?? '');
    const next = `${text.slice(0, caret)}${needsSpace ? ' ' : ''}@${text.slice(caret)}`;
    const position = caret + (needsSpace ? 2 : 1);
    setText(next);
    setMention({ start: position - 1, query: '' });
    setActiveIndex(0);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(position, position);
    });
  };

  const submit = async () => {
    if (pending) return;
    const content = text.trim();
    if (!content && !file) return;
    if (file && file.size > MESSAGE_FILE_MAX_BYTES) {
      toast.error(`파일은 ${FILE_LIMIT_TEXT}까지 보낼 수 있어요`);
      return;
    }
    let payload: { name: string; size: number; mimeType: string; dataUrl: string } | null = null;
    if (file) {
      setReading(true);
      try {
        payload = { name: file.name, size: file.size, mimeType: file.type, dataUrl: await readAsDataUrl(file) };
      } catch (error) {
        toast.apiError(error);
        return;
      } finally {
        setReading(false);
      }
    }
    send.mutate({ chatRoomId: room.id, content, file: payload });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return; // 한글 조합 중 Enter는 보내지 않는다
    if (mention) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMention(null);
        return;
      }
      if (candidates.length > 0) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setActiveIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length);
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          insertMention(candidates[activeIndex] ?? candidates[0]);
          return;
        }
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const lines = Math.min(MAX_LINES, Math.max(1, text.split('\n').length));

  return (
    <div className="relative flex flex-none flex-col gap-2 border-t border-line bg-surface px-5 py-3">
      {mention ? (
        <div role="listbox" aria-label="멘션할 멤버" className="absolute bottom-full left-5 z-30 mb-1 flex w-72 flex-col overflow-hidden rounded-md border border-line bg-surface py-1 shadow-pop">
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-ink-disabled" aria-disabled="true">
            <b className="font-semibold">@AI 호출</b> · AI 어시스턴트에게 묻기 · {soonLabel('P2')}
          </div>
          {candidates.length === 0 ? <div className="px-3 py-2 text-xs text-ink-3">일치하는 멤버가 없어요</div> : null}
          {candidates.map((target, index) => (
            <button
              key={`${target.kind}-${target.id}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault();
                insertMention(target);
              }}
              className={cn('flex items-center gap-2 px-3 py-1.5 text-left text-sm', index === activeIndex ? 'bg-brand-tint hover:bg-brand-tint-hover' : 'hover:bg-surface-2')}
            >
              <Icon name={target.kind === 'department' ? 'users' : 'user'} size="sm" className="text-ink-3" />
              {target.name}
              <span className="ml-auto text-cap text-ink-3">{target.kind === 'department' ? '부서 알림' : '멤버'}</span>
            </button>
          ))}
        </div>
      ) : null}
      {file ? (
        <div className="flex w-fit items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm">
          <Icon name="clip" size="sm" className="text-ink-3" />
          <span className="max-w-[320px] truncate">{file.name}</span>
          <span className={cn('text-cap', file.size > MESSAGE_FILE_MAX_BYTES ? 'text-danger' : 'text-ink-3')}>
            {fmtBytes(file.size)}
            {file.size > MESSAGE_FILE_MAX_BYTES ? ` · ${FILE_LIMIT_TEXT}까지 보낼 수 있어요` : ''}
          </span>
          <IconButton icon="x" label="첨부 취소" size="sm" disabled={pending} onClick={() => setFile(null)} />
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        value={text}
        rows={lines}
        maxLength={MESSAGE_CONTENT_MAX}
        aria-label="메시지 입력"
        placeholder={file ? '파일과 같이 보낼 말을 적어 주세요 (선택)' : '메시지 입력 · @ 로 멤버 멘션'}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onClick={(event) => updateMention(event.currentTarget.value, event.currentTarget.selectionStart)}
        onBlur={() => setMention(null)}
        className="w-full resize-none rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm leading-normal outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--color-brand-tint)]"
      />
      <div className="flex items-center gap-1.5">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            event.target.value = '';
          }}
        />
        <IconButton icon="clip" label={`파일 첨부 (${FILE_LIMIT_TEXT}까지, 1개)`} title={`파일 첨부 (${FILE_LIMIT_TEXT}까지, 1개)`} disabled={pending} onClick={() => fileInputRef.current?.click()} />
        <Button size="sm" variant="ghost" onMouseDown={(event) => event.preventDefault()} onClick={startMention} disabled={pending}>
          @ 멘션
        </Button>
        <SoonButton size="sm" variant="ghost">
          @AI 호출
        </SoonButton>
        <span className="ml-auto text-cap text-ink-3">Enter 보내기 · Shift+Enter 줄바꿈</span>
        <Button variant="primary" size="sm" icon="send" disabled={pending || (!text.trim() && !file)} onClick={() => void submit()}>
          {pending ? '보내는 중…' : '보내기'}
        </Button>
      </div>
    </div>
  );
}
