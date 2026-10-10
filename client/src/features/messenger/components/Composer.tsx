'use client';

// 메시지 입력창: 글 + 파일 여러 개(REQ-MSG-003, 스키마 3차부터 MESSAGE_ATTACHMENT_MAX_COUNT개까지) 또는 이모티콘(18번·19번), @멘션 고르기(REQ-MSG-005). Enter 보내기 · Shift+Enter 줄바꿈.
// 이모티콘은 서버 첨부 API가 받지 않아 파일과 함께 고를 수 없다(글에 작게 넣는 것은 글이라 된다, 23번). 최근 이모티콘은 고를 때가 아니라 보낼 때 쌓는다 (골랐다 빼면 최근이 아니다).
// 글자로 추천(23번): 글에 맞는 이모티콘을 입력창 위에 보인다. 이모티콘을 이미 골랐거나 파일이 있으면 숨기고, Esc로 닫으면 글을 고칠 때까지 숨긴다.
// 보내면 입력창을 바로 비우고 대화에 '보내는 중' 말풍선을 띄운다. 실패는 그 말풍선에서 다시 보낸다 (useMessageOutbox).
import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { MESSAGE_ATTACHMENT_MAX_COUNT, inlineEmoticonKeys, inlineEmoticonText, inlineEmoticonToken, type MessageEmoticonKey } from '@fantasteel/shared';
import { MESSAGE_CONTENT_MAX, MESSAGE_FILE_MAX_BYTES, type ChatRoomDetailView } from '@/api/messenger';
import type { MentionTarget } from '@/api/messengerRules';
import { Button } from '@/components/Button';
import { SoonButton, soonLabel } from '@/components/ComingSoon';
import { EmoticonImage, EmoticonPicker, EmoticonSuggestions, emoticonLabelOf } from '@/features/messenger/components/Emoticon';
import { pushRecentEmoticon } from '@/features/messenger/lib/emoticonRecent';
import { suggestEmoticons } from '@/features/messenger/lib/emoticonSuggest';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useMe } from '@/hooks/useMe';
import { useMessageOutbox } from '@/hooks/useMessenger';
import { useMessageComposeStore } from '@/stores/useMessageComposeStore';
import { useMessengerLiveStore } from '@/stores/useMessengerLiveStore';
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
  const myId = useMe().employeeId;
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [emoticon, setEmoticon] = useState<MessageEmoticonKey | null>(null);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reading, setReading] = useState(false);
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { send } = useMessageOutbox(room.id);
  // 메시지 메뉴의 '답장'으로 고른 메시지 (이 방 것만)
  const replyTo = useMessageComposeStore((state) => (state.replyTo?.chatRoomId === room.id ? state.replyTo : null));
  const clearReply = () => useMessageComposeStore.getState().setReplyTo(null);
  const pending = reading;

  const candidates = useMemo<MentionTarget[]>(() => {
    if (!mention) return [];
    const query = mention.query.toLowerCase();
    return room.mentionTargets.filter((target) => target.name.toLowerCase().includes(query)).slice(0, MAX_CANDIDATES);
  }, [mention, room.mentionTargets]);

  const suggestions = useMemo<MessageEmoticonKey[]>(
    () => (emoticon || files.length > 0 || mention || suggestDismissed ? [] : suggestEmoticons(text)),
    [emoticon, files.length, mention, suggestDismissed, text],
  );

  const pickEmoticon = (key: MessageEmoticonKey) => {
    setEmoticon(key);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  /** 글에 작게 넣기 (23번): 커서 자리(고른 글이 있으면 그 자리)에 ':키:'를 넣는다. 고르기 창에 있어 입력창 포커스는 옮기지 않는다 */
  const insertInlineEmoticon = (key: MessageEmoticonKey) => {
    const token = inlineEmoticonToken(key);
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? text.length;
    const end = textarea?.selectionEnd ?? start;
    const next = `${text.slice(0, start)}${token}${text.slice(end)}`;
    if (next.length > MESSAGE_CONTENT_MAX) {
      toast.error(`메시지는 ${MESSAGE_CONTENT_MAX}자까지 보낼 수 있어요`);
      return;
    }
    setText(next);
    const position = start + token.length;
    // 값이 바뀌면 커서가 글 끝으로 가므로, 다음에 넣을 자리를 넣은 그림 바로 뒤로 되돌린다
    requestAnimationFrame(() => textarea?.setSelectionRange(position, position));
  };

  const updateMention = (value: string, caret: number) => {
    const next = mentionAt(value, caret);
    setMention(next);
    setActiveIndex(0);
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setText(event.target.value);
    setSuggestDismissed(false);
    // 입력 중 알림 (서버 모드만, 소켓 훅이 간격을 조절한다)
    if (event.target.value.trim()) useMessengerLiveStore.getState().sendTyping?.(room.id);
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
    if (!content && files.length === 0 && !emoticon) return;
    const tooBig = files.find((file) => file.size > MESSAGE_FILE_MAX_BYTES);
    if (tooBig) {
      toast.error(`파일은 ${FILE_LIMIT_TEXT}까지 보낼 수 있어요 (${tooBig.name})`);
      return;
    }
    let payload: { name: string; size: number; mimeType: string; dataUrl: string }[] = [];
    if (files.length > 0) {
      setReading(true);
      try {
        payload = await Promise.all(files.map(async (file) => ({ name: file.name, size: file.size, mimeType: file.type, dataUrl: await readAsDataUrl(file) })));
      } catch (error) {
        toast.apiError(error);
        return;
      } finally {
        setReading(false);
      }
    }
    send({ chatRoomId: room.id, content, files: payload, emoticonKey: emoticon, parentMessageId: replyTo?.id ?? null });
    // 글에 작게 넣은 것도 최근에 쌓는다. 큰 이모티콘을 나중에 쌓아 맨 앞에 둔다
    for (const key of inlineEmoticonKeys(content)) pushRecentEmoticon(myId, key);
    if (emoticon) pushRecentEmoticon(myId, emoticon);
    clearReply();
    setText('');
    setFiles([]);
    setEmoticon(null);
    setMention(null);
    setSuggestDismissed(false);
    onSent();
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
    if (event.key === 'Escape' && suggestions.length > 0) {
      event.preventDefault();
      setSuggestDismissed(true);
      return;
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
      {replyTo ? (
        <div className="flex items-center gap-2 rounded-md border-l-2 border-brand bg-surface-2 px-3 py-1.5 text-xs" aria-label="답장할 메시지">
          <span className="min-w-0 flex-1 truncate">
            <b className="font-semibold">{replyTo.senderName}</b>님에게 답장 · <span className="text-ink-3">{(replyTo.content ? inlineEmoticonText(replyTo.content) : null) ?? replyTo.files[0]?.name ?? (replyTo.emoticonKey ? `이모티콘 · ${emoticonLabelOf(replyTo.emoticonKey)}` : '')}</span>
          </span>
          <IconButton icon="x" label="답장 취소" size="sm" onClick={clearReply} />
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label={`첨부할 파일 ${files.length}개`}>
          {files.map((file, index) => (
            <div key={`${index}-${file.name}`} className="flex w-fit items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm">
              <Icon name="clip" size="sm" className="text-ink-3" />
              <span className="max-w-[240px] truncate">{file.name}</span>
              <span className={cn('text-cap', file.size > MESSAGE_FILE_MAX_BYTES ? 'text-danger' : 'text-ink-3')}>
                {fmtBytes(file.size)}
                {file.size > MESSAGE_FILE_MAX_BYTES ? ` · ${FILE_LIMIT_TEXT}까지 보낼 수 있어요` : ''}
              </span>
              <IconButton icon="x" label={`${file.name} 첨부 취소`} size="sm" disabled={pending} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} />
            </div>
          ))}
        </div>
      ) : null}
      {emoticon ? (
        <div className="flex w-fit items-end gap-1 rounded-md border border-line bg-surface-2 p-1.5" aria-label={`보낼 이모티콘 ${emoticonLabelOf(emoticon)}`}>
          <EmoticonImage emoticonKey={emoticon} scale={1} />
          <IconButton icon="x" label="이모티콘 빼기" size="sm" onClick={() => setEmoticon(null)} />
        </div>
      ) : null}
      {suggestions.length > 0 ? <EmoticonSuggestions keys={suggestions} onPick={pickEmoticon} onDismiss={() => setSuggestDismissed(true)} /> : null}
      <textarea
        ref={textareaRef}
        value={text}
        rows={lines}
        maxLength={MESSAGE_CONTENT_MAX}
        aria-label="메시지 입력"
        placeholder={files.length > 0 ? '파일과 같이 보낼 말을 적어 주세요 (선택)' : emoticon ? '이모티콘과 같이 보낼 말을 적어 주세요 (선택)' : '메시지 입력 · @ 로 멤버 멘션'}
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
          multiple
          className="hidden"
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? []);
            event.target.value = '';
            // 이미 고른 파일에 더한다. 넘치는 파일은 버리고 알린다
            const next = [...files, ...picked];
            if (next.length > MESSAGE_ATTACHMENT_MAX_COUNT) toast.error(`파일은 한 번에 ${MESSAGE_ATTACHMENT_MAX_COUNT}개까지 보낼 수 있어요`);
            setFiles(next.slice(0, MESSAGE_ATTACHMENT_MAX_COUNT));
          }}
        />
        <IconButton
          icon="clip"
          label={`파일 첨부 (파일마다 ${FILE_LIMIT_TEXT}까지, ${MESSAGE_ATTACHMENT_MAX_COUNT}개까지)`}
          title={`파일 첨부 (파일마다 ${FILE_LIMIT_TEXT}까지, ${MESSAGE_ATTACHMENT_MAX_COUNT}개까지)`}
          disabled={pending || files.length >= MESSAGE_ATTACHMENT_MAX_COUNT || emoticon !== null}
          onClick={() => fileInputRef.current?.click()}
        />
        <EmoticonPicker
          employeeId={myId}
          disabled={pending}
          smallOnlyReason={files.length > 0 ? '파일과 함께는 글에 작게만 넣을 수 있어요' : undefined}
          onPick={pickEmoticon}
          onInsert={insertInlineEmoticon}
        />
        <Button size="sm" variant="ghost" onMouseDown={(event) => event.preventDefault()} onClick={startMention} disabled={pending}>
          @ 멘션
        </Button>
        <SoonButton size="sm" variant="ghost">
          @AI 호출
        </SoonButton>
        <span className="ml-auto text-cap text-ink-3">Enter 보내기 · Shift+Enter 줄바꿈</span>
        <Button variant="primary" size="sm" icon="send" disabled={pending || (!text.trim() && files.length === 0 && !emoticon)} onClick={() => void submit()}>
          {reading ? '파일 읽는 중…' : '보내기'}
        </Button>
      </div>
    </div>
  );
}
