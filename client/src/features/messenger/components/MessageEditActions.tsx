'use client';

// 메시지 메뉴의 기본 동작: 답장·공지로 고정(모든 일반 메시지), 수정·삭제(내 메시지). 스키마 1차(#151)의 답글·수정·삭제 표시를 쓴다.
// 메뉴는 고르자마자 닫히므로 창은 대화 영역(Conversation)이 useMessageComposeStore를 보고 그린다.
import { useState } from 'react';
import { MESSAGE_REACTION_EMOJIS } from '@fantasteel/shared';
import { MESSAGE_CONTENT_MAX, messengerApi, type MessageView } from '@/api/messenger';
import { InputError } from '@/api/errors';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/Field';
import { Modal } from '@/components/Modal';
import { emoticonLabelOf } from '@/features/messenger/components/Emoticon';
import { MessageActionItem } from '@/features/messenger/components/MessageActionItem';
import type { MessageActionEntry, MessageActionProps } from '@/features/messenger/messageActions';
import { useAction } from '@/hooks/useAction';
import { cn } from '@/lib/cn';
import type { TaskSourceMessage } from '@/features/tasks/components/TaskFormModal';
import { useMessageComposeStore } from '@/stores/useMessageComposeStore';

const isPlain = (message: MessageView) => !message.isSystem && !message.isDeleted;

function ReplyAction({ message, closeMenu }: MessageActionProps) {
  return (
    <MessageActionItem
      icon="arrow-right"
      onClick={() => {
        useMessageComposeStore.getState().setReplyTo(message);
        closeMenu();
      }}
    >
      답장
    </MessageActionItem>
  );
}

function EditAction({ message, closeMenu }: MessageActionProps) {
  return (
    <MessageActionItem
      icon="edit"
      onClick={() => {
        useMessageComposeStore.getState().setEditing(message);
        closeMenu();
      }}
    >
      수정
    </MessageActionItem>
  );
}

function DeleteAction({ message, closeMenu }: MessageActionProps) {
  return (
    <MessageActionItem
      icon="trash"
      className="text-danger"
      onClick={() => {
        useMessageComposeStore.getState().setDeleting(message);
        closeMenu();
      }}
    >
      삭제
    </MessageActionItem>
  );
}

function PinAction({ message, room, closeMenu }: MessageActionProps) {
  const pin = useAction(messengerApi.pinMessage, { success: '공지로 고정했어요', onSuccess: closeMenu });
  const already = room.pinnedMessage?.id === message.id;
  return (
    <MessageActionItem icon="pin" disabled={already || pin.isPending} aside={already ? '고정됨' : undefined} onClick={() => pin.mutate({ chatRoomId: room.id, messageId: message.id })}>
      공지로 고정
    </MessageActionItem>
  );
}

/** 메뉴 맨 위 이모지 줄: 누르면 반응을 더하거나 뺀다 */
function ReactionAction({ message, closeMenu }: MessageActionProps) {
  const toggle = useAction(messengerApi.toggleReaction, { onSuccess: closeMenu });
  const mine = new Set(message.reactions.filter((r) => r.reactedByMe).map((r) => r.emoji));
  return (
    <div role="group" aria-label="반응 남기기" className="flex items-center justify-between gap-1 border-b border-line px-2 pb-1.5 pt-0.5">
      {MESSAGE_REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          role="menuitem"
          aria-pressed={mine.has(emoji)}
          aria-label={`${emoji} 반응${mine.has(emoji) ? ' 취소' : ''}`}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate({ messageId: message.id, emoji })}
          className={cn('flex size-8 items-center justify-center rounded-sm text-base hover:bg-surface-2', mine.has(emoji) && 'bg-brand-tint')}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function TaskAction({ message, closeMenu }: MessageActionProps) {
  return (
    <MessageActionItem
      icon="task"
      onClick={() => {
        useMessageComposeStore.getState().setTasking(message);
        closeMenu();
      }}
    >
      업무로 등록
    </MessageActionItem>
  );
}

const TASK_TITLE_FROM_MESSAGE_MAX = 50;

/** 메시지로 업무 창을 미리 채운다: 제목 = 본문 첫 줄(50자, 가정값) 또는 파일 이름·이모티콘 이름, 설명 = 본문과 보낸 사람 */
export function taskSourceOf(message: MessageView): TaskSourceMessage {
  const content = (message.content ?? '').trim();
  const firstLine = content.split('\n')[0]?.trim() ?? '';
  const base = firstLine || message.files[0]?.name || (message.emoticonKey ? `이모티콘 · ${emoticonLabelOf(message.emoticonKey)}` : '') || '메시지 확인';
  const title = base.length > TASK_TITLE_FROM_MESSAGE_MAX ? `${base.slice(0, TASK_TITLE_FROM_MESSAGE_MAX - 1)}…` : base;
  const description = [content, `— ${message.senderName}님의 메시지에서 등록`].filter(Boolean).join('\n\n');
  return { messageId: message.id, title, description };
}

export const TASK_MESSAGE_ACTION: MessageActionEntry = { key: 'task', sortOrder: 5, isAvailable: isPlain, Component: TaskAction };
export const REACTION_MESSAGE_ACTION: MessageActionEntry = { key: 'reaction', sortOrder: 0, isAvailable: isPlain, Component: ReactionAction };
export const PIN_MESSAGE_ACTION: MessageActionEntry = { key: 'pin', sortOrder: 4, isAvailable: isPlain, Component: PinAction };
export const REPLY_MESSAGE_ACTION: MessageActionEntry = { key: 'reply', sortOrder: 1, isAvailable: isPlain, Component: ReplyAction };
export const EDIT_MESSAGE_ACTION: MessageActionEntry = { key: 'edit', sortOrder: 2, isAvailable: (message) => isPlain(message) && message.isMine, Component: EditAction };
export const DELETE_MESSAGE_ACTION: MessageActionEntry = { key: 'delete', sortOrder: 3, isAvailable: (message) => isPlain(message) && message.isMine, Component: DeleteAction };

export function EditMessageModal({ message, onClose }: { message: MessageView; onClose: () => void }) {
  const [content, setContent] = useState(message.content ?? '');
  const [error, setError] = useState<string | undefined>();
  const save = useAction(messengerApi.editMessage, {
    success: '메시지를 고쳤어요',
    onSuccess: onClose,
    onError: (e) => setError(e instanceof InputError ? (e.fieldErrors.content ?? e.message) : undefined),
  });
  const unchanged = content.trim() === (message.content ?? '').trim();
  return (
    <Modal
      title="메시지 수정"
      width={520}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-cap text-ink-3">고친 메시지에는 '수정됨'이 붙어요</span>
          <Button onClick={onClose} disabled={save.isPending}>
            취소
          </Button>
          <Button variant="primary" disabled={save.isPending || unchanged} onClick={() => save.mutate({ messageId: message.id, content })}>
            {save.isPending ? '고치는 중…' : '고치기'}
          </Button>
        </>
      }
    >
      <Field label="메시지" htmlFor="edit-message-content" error={error} hint={message.files.length > 0 ? '첨부가 있어 비워도 돼요' : undefined}>
        <textarea
          id="edit-message-content"
          value={content}
          rows={4}
          maxLength={MESSAGE_CONTENT_MAX}
          autoFocus
          // 열면 글 끝에 커서를 둔다 (이어서 고치기 쉽게)
          onFocus={(event) => event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)}
          onChange={(event) => setContent(event.target.value)}
          className="w-full resize-none rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm leading-normal outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--color-brand-tint)]"
        />
      </Field>
    </Modal>
  );
}

export function DeleteMessageDialog({ message, onClose }: { message: MessageView; onClose: () => void }) {
  const remove = useAction(messengerApi.deleteMessage, { success: '메시지를 지웠어요', onSuccess: onClose });
  return (
    <ConfirmDialog title="메시지 삭제" confirmLabel="삭제" tone="danger" pending={remove.isPending} onConfirm={() => remove.mutate(message.id)} onCancel={onClose}>
      이 메시지를 지울까요? 대화에는 &lsquo;삭제된 메시지예요&rsquo;로 남고, 첨부 파일도 더는 내려받을 수 없어요.
    </ConfirmDialog>
  );
}
