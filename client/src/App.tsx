import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/api/queryClient';
import { connectRealtime, disconnectRealtime } from '@/api/realtime';
import { authApi } from '@/api/auth';
import { StateView, Toaster } from '@/components/ui';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { Shell } from '@/shell/Shell';
import { useAuthStore } from '@/stores/auth';

const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const SalesOrderListPage = lazy(() => import('@/pages/sales/SalesOrderListPage').then((m) => ({ default: m.SalesOrderListPage })));
const SalesOrderCreatePage = lazy(() => import('@/pages/sales/SalesOrderCreatePage').then((m) => ({ default: m.SalesOrderCreatePage })));
const SalesOrderDetailPage = lazy(() => import('@/pages/sales/SalesOrderDetailPage').then((m) => ({ default: m.SalesOrderDetailPage })));
const ShipmentRequestListPage = lazy(() => import('@/pages/shipment/ShipmentRequestListPage').then((m) => ({ default: m.ShipmentRequestListPage })));
const ShipmentRequestCreatePage = lazy(() => import('@/pages/shipment/ShipmentRequestCreatePage').then((m) => ({ default: m.ShipmentRequestCreatePage })));
const ShipmentRequestDetailPage = lazy(() => import('@/pages/shipment/ShipmentRequestDetailPage').then((m) => ({ default: m.ShipmentRequestDetailPage })));
const GoodsIssuePage = lazy(() => import('@/pages/shipment/GoodsIssuePage').then((m) => ({ default: m.GoodsIssuePage })));
const MillSheetPage = lazy(() => import('@/pages/shipment/MillSheetPage').then((m) => ({ default: m.MillSheetPage })));
const InventoryPage = lazy(() => import('@/pages/inventory/InventoryPage').then((m) => ({ default: m.InventoryPage })));
const MrpPage = lazy(() => import('@/pages/purchasing/MrpPage').then((m) => ({ default: m.MrpPage })));
const PurchaseRequisitionListPage = lazy(() => import('@/pages/purchasing/PurchaseRequisitionListPage').then((m) => ({ default: m.PurchaseRequisitionListPage })));
const PurchaseRequisitionDetailPage = lazy(() => import('@/pages/purchasing/PurchaseRequisitionDetailPage').then((m) => ({ default: m.PurchaseRequisitionDetailPage })));
const ActionDraftPage = lazy(() => import('@/pages/purchasing/ActionDraftPage').then((m) => ({ default: m.ActionDraftPage })));
const PurchaseOrderPage = lazy(() => import('@/pages/purchasing/PurchaseOrderPage').then((m) => ({ default: m.PurchaseOrderPage })));
const GoodsReceiptPage = lazy(() => import('@/pages/purchasing/GoodsReceiptPage').then((m) => ({ default: m.GoodsReceiptPage })));
const ApprovalPage = lazy(() => import('@/pages/purchasing/ApprovalPage').then((m) => ({ default: m.ApprovalPage })));
const ProductionPlanPage = lazy(() => import('@/pages/production/ProductionPlanPage').then((m) => ({ default: m.ProductionPlanPage })));
const ProductionResultPage = lazy(() => import('@/pages/production/ProductionResultPage').then((m) => ({ default: m.ProductionResultPage })));
const RollingAllocationPage = lazy(() => import('@/pages/production/RollingAllocationPage').then((m) => ({ default: m.RollingAllocationPage })));
const InspectionPage = lazy(() => import('@/pages/quality/InspectionPage').then((m) => ({ default: m.InspectionPage })));
const RejectedLotPage = lazy(() => import('@/pages/quality/RejectedLotPage').then((m) => ({ default: m.RejectedLotPage })));
const LotTracePage = lazy(() => import('@/pages/trace/LotTracePage').then((m) => ({ default: m.LotTracePage })));
const BusinessEventPage = lazy(() => import('@/pages/trace/BusinessEventPage').then((m) => ({ default: m.BusinessEventPage })));
const TaskNotificationPage = lazy(() => import('@/pages/collab/TaskNotificationPage').then((m) => ({ default: m.TaskNotificationPage })));
const MessengerPage = lazy(() => import('@/pages/collab/MessengerPage').then((m) => ({ default: m.MessengerPage })));
const EmployeePage = lazy(() => import('@/pages/admin/EmployeePage').then((m) => ({ default: m.EmployeePage })));
const OrganizationPage = lazy(() => import('@/pages/admin/OrganizationPage').then((m) => ({ default: m.OrganizationPage })));
const MasterDataPage = lazy(() => import('@/pages/admin/MasterDataPage').then((m) => ({ default: m.MasterDataPage })));
const AgentPage = lazy(() => import('@/pages/soon/AgentPage').then((m) => ({ default: m.AgentPage })));
const MeetingPage = lazy(() => import('@/pages/soon/MeetingPage').then((m) => ({ default: m.MeetingPage })));
const PastCasePage = lazy(() => import('@/pages/soon/PastCasePage').then((m) => ({ default: m.PastCasePage })));

/** 로그인해야 들어올 수 있는 영역. 토큰으로 사원·권한을 다시 확인하고 실시간 연결을 연다. */
function Protected() {
  const session = useAuthStore((s) => s.session);
  const setUser = useAuthStore((s) => s.setUser);
  const location = useLocation();
  const token = session?.accessToken;
  useEffect(() => {
    if (!token) return;
    connectRealtime(token);
    // 권한이 바뀌었을 수 있으니 서버 기준으로 갱신한다 (401이면 api 클라이언트가 세션을 지운다)
    authApi.me().then(setUser).catch(() => undefined);
    return () => disconnectRealtime();
  }, [token, setUser]);
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return (
    <Shell>
      <Suspense fallback={<main className="hl-main"><StateView kind="loading" title="화면 불러오는 중…" /></main>}>
        <Outlet />
      </Suspense>
    </Shell>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Protected />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="sales-orders" element={<SalesOrderListPage />} />
            <Route path="sales-orders/new" element={<SalesOrderCreatePage />} />
            <Route path="sales-orders/:id" element={<SalesOrderDetailPage />} />
            <Route path="shipment-requests" element={<ShipmentRequestListPage />} />
            <Route path="shipment-requests/new" element={<ShipmentRequestCreatePage />} />
            <Route path="shipment-requests/:id" element={<ShipmentRequestDetailPage />} />
            <Route path="goods-issues" element={<GoodsIssuePage />} />
            <Route path="mill-sheets" element={<MillSheetPage />} />
            <Route path="inventories" element={<InventoryPage />} />
            <Route path="mrp" element={<MrpPage />} />
            <Route path="purchase-requisitions" element={<PurchaseRequisitionListPage />} />
            <Route path="purchase-requisitions/:id" element={<PurchaseRequisitionDetailPage />} />
            <Route path="action-drafts/:id" element={<ActionDraftPage />} />
            <Route path="purchase-orders" element={<PurchaseOrderPage />} />
            <Route path="goods-receipts" element={<GoodsReceiptPage />} />
            <Route path="approvals" element={<ApprovalPage />} />
            <Route path="production/plans" element={<ProductionPlanPage />} />
            <Route path="production/results" element={<ProductionResultPage />} />
            <Route path="production/rolling" element={<RollingAllocationPage />} />
            <Route path="quality/inspections" element={<InspectionPage />} />
            <Route path="quality/rejected" element={<RejectedLotPage />} />
            <Route path="lots/trace" element={<LotTracePage />} />
            <Route path="business-events" element={<BusinessEventPage />} />
            <Route path="tasks" element={<TaskNotificationPage />} />
            <Route path="messenger" element={<MessengerPage />} />
            <Route path="admin/employees" element={<EmployeePage />} />
            <Route path="admin/organization" element={<OrganizationPage />} />
            <Route path="admin/master-data" element={<MasterDataPage />} />
            <Route path="agent" element={<AgentPage />} />
            <Route path="meetings" element={<MeetingPage />} />
            <Route path="past-cases" element={<PastCasePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}
