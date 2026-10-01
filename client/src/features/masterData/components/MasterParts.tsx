'use client';

// 기준정보 탭이 함께 쓰는 작은 부품: 탭 키, 행 버튼(수정·삭제), 삭제 확인, 표 바닥 안내, 수율 표시.
import { useState, type ReactNode } from 'react';
import { PERMISSION } from '@/codes';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconButton } from '@/components/IconButton';
import { useAction } from '@/hooks/useAction';
import { cn } from '@/lib/cn';
import { withEulReul } from '@/lib/josa';
import { fmtPct } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';

export const MASTER_TAB_KEYS = ['specs', 'mapping', 'grades', 'routing', 'consumption', 'items', 'parties', 'settings'] as const;
export type MasterTabKey = (typeof MASTER_TAB_KEYS)[number];
export const isMasterTabKey = (value: string | null): value is MasterTabKey => value !== null && (MASTER_TAB_KEYS as readonly string[]).includes(value);

/** 막힌 변경 버튼의 툴팁: "기준정보 관리 사용 권한이 필요해요" */
export const MASTER_LOCK_TEXT = permissionNeedText([PERMISSION.MASTER_MANAGE]);

/** 코드 링크 모양 (옛 hl-link-id) */
export const CODE_LINK = 'font-mono text-mono text-run hover:underline';

/** 열연 계획 수율 0.9798 → 97.98% */
export const yieldPercentText = (rate: string | null): string => (rate === null ? '-' : fmtPct(Number(rate), 2));

export function TableFoot({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('border-t border-line bg-surface-2 px-4 py-2.5 text-cap leading-4 text-ink-3', className)}>{children}</p>;
}

export interface RowActionsProps {
  canEdit: boolean;
  onEdit?: () => void;
  /** 삭제: 무엇을 지우는지(확인 창 제목), 지울 함수. 막혔으면 blockedReason. */
  remove?: { what: string; run: () => Promise<unknown>; success: string; blockedReason?: string | null };
}

/** 행 끝의 수정·삭제 아이콘. 사용 권한이 없으면 막고 툴팁을 보인다. 삭제는 한 번 더 묻는다. */
export function RowActions({ canEdit, onEdit, remove }: RowActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const action = useAction(() => (remove ? remove.run() : Promise.resolve(null)), {
    success: remove?.success,
    onSuccess: () => setConfirming(false),
    onError: () => setConfirming(false),
  });
  const blocked = remove?.blockedReason ?? null;
  return (
    <span className="inline-flex items-center gap-0.5">
      {onEdit ? (
        <IconButton icon="edit" label="수정" size="sm" disabled={!canEdit} title={canEdit ? '수정' : MASTER_LOCK_TEXT} onClick={onEdit} />
      ) : null}
      {remove ? (
        <IconButton
          icon="trash"
          label="삭제"
          size="sm"
          disabled={!canEdit || blocked !== null}
          title={!canEdit ? MASTER_LOCK_TEXT : blocked ? `쓰는 곳이 있어 삭제할 수 없어요 (${blocked})` : '삭제'}
          onClick={() => setConfirming(true)}
        />
      ) : null}
      {confirming && remove ? (
        <ConfirmDialog
          title={`${remove.what} 삭제`}
          confirmLabel="삭제"
          tone="danger"
          pending={action.isPending}
          onConfirm={() => action.mutate(undefined)}
          onCancel={() => setConfirming(false)}
        >
          <b className="font-semibold text-ink">{remove.what}</b>
          {withEulReul(remove.what).slice(remove.what.length)} 지울까요? 지우면 되돌릴 수 없어요. 쓰는 곳이 생겼으면 삭제가 거부돼요.
        </ConfirmDialog>
      ) : null}
    </span>
  );
}

/** 입력 창 바닥 버튼: 취소 + 저장 */
export function ModalFooter({ pending, disabled, submitLabel, onCancel, onSubmit }: { pending: boolean; disabled?: boolean; submitLabel: string; onCancel: () => void; onSubmit: () => void }) {
  return (
    <>
      <Button onClick={onCancel} disabled={pending}>
        취소
      </Button>
      <Button variant="primary" onClick={onSubmit} disabled={pending || disabled}>
        {pending ? '저장 중…' : submitLabel}
      </Button>
    </>
  );
}
