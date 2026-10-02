// 입력 창의 입력칸 오류: 저장이 InputError로 거부되면 칸별 안내를 보관한다 (api/errors.ts InputError.fieldErrors).
import { useCallback, useState } from 'react';
import { InputError } from '@/api/client';

export interface FieldErrorState {
  errors: Readonly<Record<string, string>>;
  /** 입력칸 하나의 안내 (없으면 null) */
  errorOf: (field: string) => string | null;
  /** 저장 실패 오류에서 칸별 안내를 꺼내 둔다 */
  takeFrom: (error: unknown) => void;
  /** 칸 하나(또는 전부)의 안내를 지운다 */
  clear: (field?: string) => void;
}

export function useMasterDataFieldErrors(): FieldErrorState {
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const errorOf = useCallback((field: string) => errors[field] ?? null, [errors]);
  const takeFrom = useCallback((error: unknown) => {
    setErrors(error instanceof InputError ? error.fieldErrors : {});
  }, []);
  const clear = useCallback((field?: string) => {
    setErrors((current) => {
      if (field === undefined) return Object.keys(current).length === 0 ? current : {};
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }, []);
  return { errors, errorOf, takeFrom, clear };
}
