'use client';

// 창 (옛 hl-scrim · hl-modal). Esc나 바깥을 누르면 닫힌다. 화면 전체를 덮도록 body에 띄운다.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '@/components/IconButton';

export interface ModalProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 창 너비(px). 화면보다 넓으면 화면에 맞춘다. */
  width?: number;
}

export function Modal({ title, onClose, children, footer, width = 520 }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // 열릴 때 창으로 초점을 옮기고, 닫히면 원래 자리로 돌려준다
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(18,24,32,0.46)] p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[calc(100vh-80px)] max-w-full flex-col overflow-hidden rounded-lg bg-surface shadow-pop outline-none"
        // 너비는 화면마다 다른 숫자라 style로 준다
        style={{ width }}
      >
        <header className="flex flex-none items-center gap-2.5 border-b border-line px-5.5 pt-4.5 pb-3.5">
          <h2 id={titleId} className="text-xl font-semibold">
            {title}
          </h2>
          <IconButton icon="x" label="닫기" size="sm" className="ml-auto" onClick={onClose} />
        </header>
        <div className="flex min-h-0 flex-col gap-3.5 overflow-auto px-5.5 py-4.5">{children}</div>
        {footer ? <footer className="flex flex-none justify-end gap-2 border-t border-line bg-surface-2 px-5.5 py-3.5">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
