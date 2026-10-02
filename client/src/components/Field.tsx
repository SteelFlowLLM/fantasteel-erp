// 입력 항목 묶음 (옛 hl-field): 이름 · 필수 표시 · 입력칸 · 도움말 또는 오류
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface FieldProps {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  /** 있으면 도움말 대신 빨간 글자로 보인다 */
  error?: string | null;
  /** 입력칸 id. 없으면 label이 입력칸을 감싼다. */
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, required, hint, error, htmlFor, className, children }: FieldProps) {
  const title = (
    <>
      {label}
      {required ? (
        <span className="ml-0.5 text-danger" aria-hidden="true">
          *
        </span>
      ) : null}
    </>
  );
  const note = error ? (
    <span role="alert" className="text-cap text-danger">
      {error}
    </span>
  ) : hint ? (
    <span className="text-cap text-ink-3">{hint}</span>
  ) : null;
  const labelClass = 'text-xs font-medium text-ink-2';

  if (htmlFor) {
    return (
      <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
        <label htmlFor={htmlFor} className={labelClass}>
          {title}
        </label>
        {children}
        {note}
      </div>
    );
  }
  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className={labelClass}>{title}</span>
      {children}
      {note}
    </label>
  );
}
