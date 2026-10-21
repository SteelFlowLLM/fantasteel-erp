// 강종 탭의 삭제 버튼 (서버 렌더 결과의 태그를 읽어 확인, 브라우저 없이)
// 쓰는 곳 확인은 서버가 한다(API-276). 화면은 행마다 삭제 버튼을 두고, 기준정보 관리 사용 권한이 없으면 막고 까닭을 툴팁으로 보인다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { masterDataKeys, type MasterSteelGradeView } from '@/api/masterData';
import { MASTER_LOCK_TEXT } from '@/features/masterData/components/MasterParts';
import { SteelGradeTab } from '@/features/masterData/components/SteelGradeTab';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/master-data' }));

const grade = (id: number, steelGradeCode: string): MasterSteelGradeView => ({
  id,
  steelGradeCode,
  steelGradeName: steelGradeCode,
  standardNo: 'KS D 3503',
  specCount: 0,
  steelmakingStandard: null,
  referenceText: null,
  updatedAt: '2026-10-14T00:00:00.000Z',
  codeLockedBy: [],
});

function render(canEdit: boolean): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(masterDataKeys.steelGrades(), [grade(1, 'SS275'), grade(2, 'SM355A')]);
  return renderToString(createElement(QueryClientProvider, { client }, createElement(SteelGradeTab, { canEdit }))).replace(/<!-- -->/g, '');
}

const deleteButtons = (html: string) => html.match(/<button[^>]*aria-label="삭제"[^>]*>/g) ?? [];
// class에도 disabled:opacity-55가 있어 속성으로 본다
const isDisabled = (button: string) => /\sdisabled=""/.test(button);

describe('강종 탭 삭제 버튼', () => {
  it('행마다 삭제 버튼이 있고 사용 권한이 있으면 누를 수 있다', () => {
    const buttons = deleteButtons(render(true));
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => !isDisabled(b) && b.includes('title="삭제"'))).toBe(true);
  });

  it('사용 권한이 없으면 막고 필요한 권한을 툴팁으로 보인다', () => {
    const buttons = deleteButtons(render(false));
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => isDisabled(b) && b.includes(`title="${MASTER_LOCK_TEXT}"`))).toBe(true);
  });
});
