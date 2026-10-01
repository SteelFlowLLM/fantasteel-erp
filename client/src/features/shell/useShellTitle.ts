import { useContext, useEffect } from 'react';
import { ShellTitleContext } from '@/features/shell/ShellTitleContext';

/** 화면이 상단 바의 제목·부제를 바꾼다 (예: useShellTitle('SO-2610-001', '가람중공업')). 화면을 떠나면 기본 제목으로 돌아간다. */
export function useShellTitle(title?: string, subtitle?: string): void {
  const setTitle = useContext(ShellTitleContext);
  useEffect(() => {
    setTitle({ title, subtitle });
    return () => setTitle({});
  }, [setTitle, title, subtitle]);
}
