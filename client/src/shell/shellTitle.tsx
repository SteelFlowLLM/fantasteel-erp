import { createContext, useContext, useEffect } from 'react';

export interface ShellTitle { title?: string; subtitle?: string }
export const ShellTitleContext = createContext<(t: ShellTitle) => void>(() => {});

/** 화면이 상단 바의 제목·부제를 바꾼다 (예: 수주번호). 화면을 떠나면 기본 제목으로 돌아간다. */
export function useShellTitle(title?: string, subtitle?: string): void {
  const set = useContext(ShellTitleContext);
  useEffect(() => {
    set({ title, subtitle });
    return () => set({});
  }, [set, title, subtitle]);
}
