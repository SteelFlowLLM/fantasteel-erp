'use client';

// 화면 잠금: 주소의 화면을 열 권한이 없으면 화면 대신 잠금 상태를 보인다 (REQ-AUTH-003, COM-002).
// 여는 조건은 레일과 같은 표(screens.ts)를 쓴다. 조회 권한만 있으면 화면은 열리고, 화면 안의 변경 버튼이 막힌다.
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ERROR_MESSAGE, PERMISSION_LABEL } from '@/codes';
import { ButtonLink } from '@/components/Button';
import { PageMain } from '@/components/Page';
import { StateView } from '@/components/StateView';
import { accessRequirementText, canOpenScreen, screenOfPath } from '@/features/shell/screens';
import { useMe } from '@/hooks/useMe';

export function RouteGuard({ children }: { children: ReactNode }) {
  const me = useMe();
  const pathname = usePathname();
  const screen = screenOfPath(pathname);
  if (!screen || canOpenScreen(me, screen.access)) return <>{children}</>;
  return (
    <PageMain>
      <StateView
        kind="lock"
        text={
          <>
            {ERROR_MESSAGE['COM-002']} · {accessRequirementText(screen.access, (permission) => PERMISSION_LABEL[permission])}. 권한은 관리자가
            &lsquo;부서·직급·권한&rsquo;에서 역할별로 정해요.
          </>
        }
        code="COM-002"
        actions={
          <ButtonLink href="/dashboard" variant="primary" size="sm">
            대시보드로
          </ButtonLink>
        }
      />
    </PageMain>
  );
}
