// 확인 창: 되돌릴 수 없는 일을 하기 전에 한 번 더 묻는다.
import type { ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';

export interface ConfirmDialogProps {
  title: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}

export function ConfirmDialog({ title, confirmLabel, cancelLabel = '취소', tone = 'primary', pending, onConfirm, onCancel, children }: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={440}
      footer={
        <>
          <Button onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          {/* 확인 단추는 되돌리기 어려운 일을 한다: 철강맨AI 화면 조작이 누르지 않는다 (이슈 #479) */}
          <Button variant={tone} onClick={onConfirm} disabled={pending} data-ai-block="">
            {pending ? '처리하는 중…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-normal text-ink-2">{children}</div>
    </Modal>
  );
}
