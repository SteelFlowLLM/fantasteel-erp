// 입력 항목 묶음 (옛 hl-field): 이름 · 필수 표시 · 입력칸 · 도움말 또는 오류
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface FieldProps {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  /** 있으면 도움말 대신 빨간 글자로 보인다 */
  error?: string | null;
  /** 입력칸 id. 없으면 label이 입력칸을 감싼다. */
  htmlFor?: string;
  /**
   * 안에 입력칸이 아니라 단추·상태 표시가 들어 있으면 true. label이 감싸면 안의 단추 접근성 이름이 단추 글자가 아닌 label 글이 되므로
   * label 대신 묶음(group)으로 감싸고 이름만 붙인다. 입력칸이 있는 Field는 그대로 둔다(label을 누르면 입력칸으로 가는 동작 유지)
   */
  group?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({ label, required, hint, error, htmlFor, group, className, children }: FieldProps) {
  const titleId = useId();
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

  if (group) {
    return (
      <div role="group" aria-labelledby={titleId} className={cn('flex min-w-0 flex-col gap-1.5', className)}>
        <span id={titleId} className={labelClass}>
          {title}
        </span>
        {children}
        {note}
      </div>
    );
  }
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
