'use client';

// 기준정보 탭이 함께 쓰는 작은 부품: 탭 키, 행 버튼(수정·삭제)과 삭제 확인 창, 표 바닥 안내, 수율 표시.
import { useState, type ReactNode } from 'react';
import { PERMISSION } from '@/codes';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconButton } from '@/components/IconButton';
import { useAction } from '@/hooks/useAction';
import { cn } from '@/lib/cn';
import { fmtPct } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';

export const MASTER_TAB_KEYS = ['specs', 'mapping', 'grades', 'routing', 'consumption', 'items', 'customer-supplier-yard', 'settings'] as const;
export type MasterTabKey = (typeof MASTER_TAB_KEYS)[number];
export const isMasterTabKey = (value: string | null): value is MasterTabKey => value !== null && (MASTER_TAB_KEYS as readonly string[]).includes(value);

/** 막힌 변경 버튼의 툴팁: "기준정보 관리 사용 권한이 필요해요" */
export const MASTER_LOCK_TEXT = permissionNeedText([PERMISSION.MASTER_MANAGE]);

/** 코드 링크 모양 (옛 hl-link-id) */
export const CODE_LINK = 'font-mono text-mono text-run hover:underline';

/** 열연 계획 수율 0.9798 → 97.98% */
export const formatYieldPercent = (rate: string | null): string => (rate === null ? '-' : fmtPct(Number(rate), 2));

export function TableFoot({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('border-t border-line bg-surface-2 px-4 py-2.5 text-cap leading-normal text-ink-3', className)}>{children}</p>;
}

export interface RowActionsProps {
  canEdit: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

/** 행 끝의 수정·삭제 아이콘. 사용 권한이 없으면 막고 툴팁을 보인다 */
export function RowActions({ canEdit, onEdit, onDelete }: RowActionsProps) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {onEdit ? (
        <IconButton icon="edit" label="수정" size="sm" disabled={!canEdit} title={canEdit ? '수정' : MASTER_LOCK_TEXT} onClick={onEdit} />
      ) : null}
      {onDelete ? (
        <IconButton icon="trash" label="삭제" size="sm" disabled={!canEdit} title={canEdit ? '삭제' : MASTER_LOCK_TEXT} onClick={onDelete} />
      ) : null}
    </span>
  );
}

/** 지울 기준정보 한 행. object는 "고객사를"처럼 조사까지 붙인 이름 */
export interface MasterDeleteTarget {
  id: number;
  name: string;
  object: string;
  remove: (id: number) => Promise<void>;
}

/** 삭제 확인 창. 쓰는 곳이 있으면 서버가 COM-004와 쓰는 곳 이름으로 막고 토스트로 보인다 ([05] 7-2) */
function DeleteMasterDialog({ target, onClose }: { target: MasterDeleteTarget; onClose: () => void }) {
  const remove = useAction(target.remove, { success: `${target.object} 삭제했어요`, onSuccess: onClose });
  return (
    <ConfirmDialog title={`${target.object} 삭제할까요?`} confirmLabel="삭제" tone="danger" pending={remove.isPending} onCancel={onClose} onConfirm={() => remove.mutate(target.id)}>
      <b className="font-semibold text-ink">{target.name}</b> · 지우면 되돌릴 수 없어요. 수주·LOT처럼 쓰는 곳이 있으면 지울 수 없어요.
    </ConfirmDialog>
  );
}

/** 행 삭제: open(대상)으로 확인 창을 열고, dialog를 화면에 둔다 */
export function useMasterDelete() {
  const [target, setTarget] = useState<MasterDeleteTarget | null>(null);
  const dialog = target ? <DeleteMasterDialog target={target} onClose={() => setTarget(null)} /> : null;
  return { open: setTarget, dialog };
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

/**
 * 버튼 묶음(Segmented 등)을 담는 입력 항목. 모양은 components/Field와 같지만 <label>로 감싸지 않는다.
 * <label> 안에 버튼을 두면 라벨·도움말을 누를 때 첫 버튼이 눌려 고른 값이 바뀐다(검토 반영). 버튼 묶음의 이름은 묶음 쪽(Segmented ariaLabel)이 갖는다.
 */
export function ButtonGroupField({ label, required, hint, children }: { label: string; required?: boolean; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-2">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </span>
      {children}
      {hint ? <span className="text-cap text-ink-3">{hint}</span> : null}
    </div>
  );
}
