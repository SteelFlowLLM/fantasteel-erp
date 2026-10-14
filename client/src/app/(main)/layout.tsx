import type { ReactNode } from 'react';
import { MainShell } from '@/features/shell/MainShell';

/** 로그인 후 화면: B안 셸(레일·상단 바) 안에 그린다 */
export default function MainLayout({ children }: { children: ReactNode }) {
  return <MainShell>{children}</MainShell>;
}
