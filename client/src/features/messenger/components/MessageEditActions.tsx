'use client';

// 메시지 메뉴의 기본 동작: 답장(모든 일반 메시지), 수정·삭제(내 메시지). 스키마 1차(#151)의 답글·수정·삭제 표시를 쓴다.
// 메뉴는 고르자마자 닫히므로 창은 대화 영역(Conversation)이 useMessageComposeStore를 보고 그린다.
import { useState } from 'react';
import { MESSAGE_CONTENT_MAX, messengerApi, type MessageView } from '@/api/messenger';
import { InputError } from '@/api/errors';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/Field';
import { Modal } from '@/components/Modal';
import { MessageActionItem } from '@/features/messenger/components/MessageActionItem';
import type { MessageActionEntry, MessageActionProps } from '@/features/messenger/messageActions';
import { useAction } from '@/hooks/useAction';
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
      <Field label="메시지" htmlFor="edit-message-content" error={error} hint={message.file ? '첨부가 있어 비워도 돼요' : undefined}>
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
