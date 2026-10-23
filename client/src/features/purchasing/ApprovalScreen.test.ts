// 승인함 빈 화면 그리기 점검 (dev 서버 없이): 승인 대기가 없을 때 "없어요"를 한 번만, 안내는 두 줄로 보이는지.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { approvalKeys } from '@/api/approvals';
import { ApprovalScreen } from '@/features/purchasing/ApprovalScreen';
import { MeContext } from '@/hooks/useMe';
import { SEED_EMPLOYEE_NO } from '@/test/actors';
import { sessionUserOf } from '@/test/sessionUsers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/approvals' }));

describe('승인함 빈 화면', () => {
  it('승인 대기가 없으면 "없어요"는 오른쪽에 한 번만, 안내는 두 문장을 줄로 나눈다', () => {
    const me = sessionUserOf(SEED_EMPLOYEE_NO.qualityHead);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(approvalKeys.inbox(), []);
    const html = renderToString(createElement(QueryClientProvider, { client }, createElement(MeContext.Provider, { value: me }, createElement(ApprovalScreen))));
    expect(html).toContain('승인할 항목이 없어요');
    expect(html).not.toContain('승인 대기 구매요청이 없어요');
    expect(html).toMatch(/부서장으로 지정돼 있어요\.<br\/>/);
  });
});
