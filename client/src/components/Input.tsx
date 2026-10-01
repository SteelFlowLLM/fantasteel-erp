// 입력칸 (옛 hl-input · hl-selectwrap · hl-inputwrap). 오류면 invalid를 켠다 (aria-invalid).
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { cn } from '@/lib/cn';

const FIELD =
  'w-full rounded-sm border border-line-strong bg-surface text-sm text-ink outline-none placeholder:text-ink-3 ' +
  'focus:border-run focus:shadow-[0_0_0_2px_var(--color-run-bg)] focus-visible:outline-none ' +
  'read-only:bg-surface-2 read-only:text-ink-2 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-disabled ' +
  'aria-invalid:border-danger aria-invalid:bg-[#fff9f8]';

export const inputClass = (className?: string) => cn(FIELD, 'h-8', className);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** 숫자는 오른쪽 정렬 */
  numeric?: boolean;
  /** 왼쪽 아이콘 */
  leadingIcon?: IconName;
  /** 오른쪽 단위 글자 (예: t, 일) */
  suffix?: string;
}

export function Input({ invalid, numeric, leadingIcon, suffix, className, ...rest }: InputProps) {
  const input = (
    <input
      aria-invalid={invalid || undefined}
      className={cn(FIELD, 'h-8', leadingIcon ? 'pl-[30px]' : 'pl-2.5', suffix ? 'pr-8' : 'pr-2.5', numeric && 'text-right tabular-nums', className)}
      {...rest}
    />
  );
  if (!leadingIcon && !suffix) return input;
  return (
    <span className="relative block">
      {leadingIcon ? <Icon name={leadingIcon} className="absolute top-2 left-[9px] text-ink-3" /> : null}
      {input}
      {suffix ? <span className="pointer-events-none absolute top-[7px] right-2.5 text-xs text-ink-3">{suffix}</span> : null}
    </span>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export function Select({ invalid, className, children, ...rest }: SelectProps) {
  return (
    <span className="relative block">
      <select aria-invalid={invalid || undefined} className={cn(FIELD, 'h-8 appearance-none pr-[30px] pl-2.5', className)} {...rest}>
        {children}
      </select>
      <Icon name="chevron-down" className="pointer-events-none absolute top-2 right-[9px] text-ink-3" />
    </span>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ invalid, className, rows = 3, ...rest }: TextareaProps) {
  return <textarea rows={rows} aria-invalid={invalid || undefined} className={cn(FIELD, 'resize-none px-2.5 py-2 leading-5', className)} {...rest} />;
}
