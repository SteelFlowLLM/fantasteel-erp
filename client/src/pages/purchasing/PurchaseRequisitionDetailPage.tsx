// 구매요청 상세 (REQ-PUR-001·002). 알림·승인함·초안 화면의 링크가 여기로 온다.
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { purchaseRequisitionApi } from '@/api/purchasing';
import { Icon, QueryBoundary, StateView } from '@/components/ui';
import { useShellTitle } from '@/shell/shellTitle';
import { canView, isDepartmentHead, useMe } from '@/stores/auth';
import { RequisitionPanel } from '@/features/purchasing/RequisitionPanel';

export function PurchaseRequisitionDetailPage() {
  const me = useMe();
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const detail = useQuery({ queryKey: ['purchase-requisitions', 'detail', id], queryFn: () => purchaseRequisitionApi.get(id), enabled: valid });
  useShellTitle(detail.data ? `구매요청 · ${detail.data.purchaseRequisitionNo}` : '구매요청', detail.data?.requester.employeeName);
  const canList = canView(me, 'PURCHASE_REQUISITION_CREATE', 'PO_CONFIRM');

  if (!valid) {
    return (
      <main className="hl-main">
        <StateView kind="empty" title="구매요청을 찾을 수 없어요" actions={<Link className="hl-btn" to="/purchase-requisitions">구매요청 목록</Link>} />
      </main>
    );
  }
  return (
    <main className="hl-main" style={{ gap: 14 }}>
      <QueryBoundary query={detail}>
        {(pr) => (
          <RequisitionPanel
            key={pr.id}
            pr={pr}
            crumb={
              <>
                {canList ? <Link to="/purchase-requisitions">구매요청</Link> : isDepartmentHead(me) ? <Link to="/approvals">승인함</Link> : <span>구매요청</span>}
                <Icon name="chevron-right" size="sm" />
                {pr.purchaseRequisitionNo}
              </>
            }
            headerActions={
              <>
                {pr.approverId === me.employeeId ? <Link className="hl-btn" to="/approvals"><Icon name="approve" />승인함</Link> : null}
                {canList ? <Link className="hl-btn" to={`/purchase-requisitions?pr=${pr.id}`}><Icon name="cart" />목록</Link> : null}
              </>
            }
          />
        )}
      </QueryBoundary>
    </main>
  );
}
