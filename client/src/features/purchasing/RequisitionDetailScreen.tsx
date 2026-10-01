'use client';

// 구매요청 상세 (/purchase-requisitions/[id]): 목록 미리보기와 같은 패널을 한 화면으로 본다.
// 경로: 목록 조회 권한이 있으면 '구매요청', 없고 부서장이면 '승인함'.
import Link from 'next/link';
import { PERMISSION } from '@/codes';
import { ButtonLink } from '@/components/Button';
import { PageMain } from '@/components/Page';
import { StateView } from '@/components/StateView';
import { RequisitionPanel } from '@/features/purchasing/components/RequisitionPanel';
import { useCanView, useIsDepartmentHead } from '@/hooks/usePermission';

export function RequisitionDetailScreen({ idText }: { idText: string }) {
  const canList = useCanView(PERMISSION.PURCHASE_REQUISITION_CREATE, PERMISSION.PURCHASE_ORDER_CONFIRM);
  const isHead = useIsDepartmentHead();
  const id = /^\d+$/.test(idText) ? Number(idText) : null;

  if (id === null) {
    return (
      <PageMain>
        <StateView
          kind="empty"
          title="구매요청을 찾을 수 없어요"
          actions={
            <ButtonLink href="/purchase-requisitions" size="sm">
              구매요청 목록
            </ButtonLink>
          }
        />
      </PageMain>
    );
  }

  const crumb = canList ? (
    <Link href={`/purchase-requisitions?pr=${id}`} className="hover:underline">
      구매요청
    </Link>
  ) : isHead ? (
    <Link href={`/approvals?pr=${id}`} className="hover:underline">
      승인함
    </Link>
  ) : (
    '구매요청'
  );

  return (
    <PageMain>
      <RequisitionPanel
        requisitionId={id}
        crumb={crumb}
        extraActions={
          <>
            {isHead ? (
              <ButtonLink href={`/approvals?pr=${id}`} size="sm" icon="approve">
                승인함
              </ButtonLink>
            ) : null}
            {canList ? (
              <ButtonLink href={`/purchase-requisitions?pr=${id}`} size="sm">
                목록
              </ButtonLink>
            ) : null}
          </>
        }
      />
    </PageMain>
  );
}
