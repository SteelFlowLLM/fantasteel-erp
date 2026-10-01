'use client';

// 사용자 메뉴: 이름 · 부서 · 역할, 부서장 표시(역할이 아님), 계정 바꾸기, 시드로 초기화
import { useState } from 'react';
import { ROLE_LABEL } from '@/codes';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { Tag } from '@/components/Tag';
import { PopHead, PopItem, PopPanel } from '@/features/shell/PopPanel';
import { useMe } from '@/hooks/useMe';
import { usePopover } from '@/hooks/usePopover';
import { useResetToSeed } from '@/hooks/useResetToSeed';
import { isDepartmentHead } from '@/lib/permissions';
import { useSessionStore } from '@/stores/useSessionStore';
import { useShellStore } from '@/stores/useShellStore';

export function UserMenu() {
  const me = useMe();
  const popover = usePopover<HTMLDivElement>();
  const signOut = useSessionStore((state) => state.signOut);
  const closeAiPanel = useShellStore((state) => state.closeAiPanel);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const reset = useResetToSeed(() => setConfirmingReset(false));
  const isHead = isDepartmentHead(me);
  const headTitle = isHead ? `${me.headDepartmentNames.join('·')} 부서장 · 구매요청 승인권자` : undefined;

  const switchAccount = () => {
    popover.setOpen(false);
    closeAiPanel();
    // (main) 레이아웃이 세션이 비면 계정 선택 화면으로 보낸다
    signOut();
  };

  return (
    <div ref={popover.ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={popover.open}
        onClick={() => popover.setOpen(!popover.open)}
        className="ml-2 flex h-10 items-center gap-2 border-l border-line pr-2 pl-3 text-left hover:bg-surface-2"
      >
        <span className="flex flex-col leading-[15px]">
          <span className="flex items-center gap-1.5">
            <b className="text-sm font-semibold">{me.employeeName}</b>
            {isHead ? (
              <Tag tone="outline" size="sm" title={headTitle}>
                부서장
              </Tag>
            ) : null}
          </span>
          <small className="text-cap text-ink-3">
            {me.departmentName} · {ROLE_LABEL[me.roleCode]}
          </small>
        </span>
        <Icon name="chevron-down" size="sm" className="text-ink-3" />
      </button>
      {popover.open ? (
        <PopPanel label="내 계정 메뉴" role="menu" placement="right-narrow">
          <PopHead stacked>
            <span className="flex items-center gap-1.5">
              <b className="text-base font-semibold">{me.employeeName}</b>
              <span className="text-cap text-ink-3">{me.jobGradeName}</span>
              {isHead ? (
                <Tag tone="outline" title={headTitle}>
                  부서장
                </Tag>
              ) : null}
            </span>
            <span className="text-cap text-ink-3">
              사원번호 {me.employeeNo} · {me.departmentName} · {ROLE_LABEL[me.roleCode]}
            </span>
            {isHead ? <span className="text-cap text-ink-3">{me.headDepartmentNames.join('·')} 부서장 (구매요청 승인권자)</span> : null}
          </PopHead>
          <PopItem role="menuitem" centered onClick={switchAccount}>
            <Icon name="users" className="text-ink-3" />
            계정 바꾸기
          </PopItem>
          <PopItem
            role="menuitem"
            centered
            onClick={() => {
              popover.setOpen(false);
              setConfirmingReset(true);
            }}
          >
            <Icon name="refresh" className="text-ink-3" />
            시드로 초기화
          </PopItem>
        </PopPanel>
      ) : null}
      {confirmingReset ? (
        <ConfirmDialog
          title="시드로 초기화"
          confirmLabel="초기화"
          tone="danger"
          pending={reset.isPending}
          onConfirm={() => reset.mutate()}
          onCancel={() => setConfirmingReset(false)}
        >
          이 브라우저의 가짜 데이터를 처음 시드 상태로 되돌려요. 등록한 수주·구매요청 같은 데이터가 모두 지워지고, 열려 있는 다른 탭에도 바로
          반영돼요. 되돌릴 수 없어요.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
