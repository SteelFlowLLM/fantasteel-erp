import { createContext } from 'react';

export interface ShellTitle {
  title?: string;
  subtitle?: string;
}

/** 화면이 상단 바 제목을 바꿀 때 쓰는 setter (예: 수주번호). AppFrame이 채운다. */
export const ShellTitleContext = createContext<(title: ShellTitle) => void>(() => undefined);
