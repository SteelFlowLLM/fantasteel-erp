// 추가 후보 위젯 (REQ-DSH-002): 원료 잔량 대비 소요 · 강종별 불합격률 · 납기 위험 수주 · 구매 진행 · 출하 실적 · 여재 보유 기간 · 생산량.
// 숫자는 모두 api/dashboard.ts가 core 읽기 모델에서 가져온 값이다.
import Link from 'next/link';
import { PROCESS_TYPE_LABEL, PURCHASE_REQUISITION_STATUS_LABEL, type PurchaseRequisitionStatus } from '@/codes';
import type {
  DeliveryRiskData,
  ProductionVolumeData,
  PurchaseProgressData,
  RawMaterialBalanceData,
  RejectRateData,
  ShipmentResultData,
  SurplusAgeData,
} from '@/api/dashboard';
import { Icon } from '@/components/Icon';
import { Table, Td, Th } from '@/components/Table';
import { DailyBars } from '@/features/dashboard/components/DailyBars';
import { Figure, WidgetBody, WidgetEmpty, WidgetFrame, type WidgetProps } from '@/features/dashboard/components/WidgetFrame';
import { dueLabel } from '@/features/dashboard/lib/widgetMath';
import { useDashboardWidget, useDashboardWidgetAccess } from '@/hooks/useDashboardWidget';
import { decCmp } from '@/lib/decimal';
import { fmtInt, fmtMD, fmtPct, fmtTon } from '@/lib/format';
import { cn } from '@/lib/cn';

const pct = (part: number, whole: number): string => `${whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0}%`;

// ── 원료 잔량 대비 소요 ─────────────────────────────────

function RawMaterialBody({ data }: { data: RawMaterialBalanceData }) {
  if (data.materials.length === 0) return <WidgetEmpty>등록된 원료가 없어요</WidgetEmpty>;
  return (
    <>
      <Table compact className="min-w-[520px] [&_td]:px-2 [&_th]:sticky [&_th]:top-0 [&_th]:px-2">
        <thead>
          <tr>
            <Th>원료</Th>
            <Th align="right">잔량</Th>
            <Th align="right">입고예정</Th>
            <Th align="right">총소요</Th>
            <Th align="right">순소요</Th>
            <Th className="w-24" title="잔량 ÷ 총소요">
              잔량 / 총소요
            </Th>
          </tr>
        </thead>
        <tbody>
          {data.materials.map((m) => {
            const short = decCmp(m.netTon, 0) > 0;
            const gross = Number(m.grossTon);
            return (
              <tr key={m.itemId} data-risk={short || undefined}>
                <Td className="max-w-36 truncate" title={`${m.itemName} (${m.itemCode})`}>
                  <b className="font-semibold">{m.itemName}</b> <span className="font-mono text-cap text-ink-3">{m.itemCode}</span>
                </Td>
                <Td align="right">{fmtTon(m.onHandTon)}</Td>
                <Td
                  align="right"
                  className={decCmp(m.coveredScheduledTon, 0) > 0 ? undefined : 'text-ink-3'}
                  title={`입고예정 합계 ${fmtTon(m.scheduledReceiptTon)} 중 이 계획들이 필요일까지 받아 쓰는 몫 ${fmtTon(m.coveredScheduledTon)}`}
                >
                  {fmtTon(m.coveredScheduledTon)}
                </Td>
                <Td align="right">{fmtTon(m.grossTon)}</Td>
                <Td align="right" title={m.firstShortageDate ? `처음 부족한 필요일 ${m.firstShortageDate}` : undefined}>
                  {short ? <b className="font-semibold text-danger">부족 {fmtTon(m.netTon)}</b> : fmtTon(m.netTon)}
                </Td>
                <Td>
                  {gross > 0 ? (
                    <div className="h-1.5 overflow-hidden rounded-[3px] bg-surface-3">
                      <span className={cn('block h-full', short ? 'bg-danger' : 'bg-ok')} style={{ width: pct(Number(m.onHandTon), gross) }} />
                    </div>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <span className="px-4 py-2 text-cap text-ink-3">
        MRP: 필요일이 {fmtMD(data.to)}까지인 계획(지난 필요일 포함)의 남은 히트 소요 · 순소요 = 총소요 − 잔량 − 입고예정 · 입고예정 = 이 계획들이 필요일까지 받아 쓰는 몫
      </span>
    </>
  );
}

export function RawMaterialBalanceWidget(props: WidgetProps) {
  const access = useDashboardWidgetAccess('RAW_MATERIAL_BALANCE');
  const query = useDashboardWidget('RAW_MATERIAL_BALANCE', access.allowed);
  return (
    <WidgetFrame widgetKey="RAW_MATERIAL_BALANCE" {...props} meta={query.data ? `생산계획 ${query.data.planCount}건 · 필요일 ~${fmtMD(query.data.to)}` : null}>
      <WidgetBody allowed={access.allowed} permissions={access.permissions} query={query}>
        {(data) => <RawMaterialBody data={data} />}
      </WidgetBody>
    </WidgetFrame>
  );
}

// ── 강종별 불합격률 ─────────────────────────────────────

function RejectRateBody({ data }: { data: RejectRateData }) {
  if (data.grades.length === 0) return <WidgetEmpty>등록된 강종이 없어요</WidgetEmpty>;
  // 불합격률은 작은 값이라 가장 큰 값(최소 10%)을 막대 끝으로 잡는다
  const scale = Math.max(0.1, ...data.grades.map((g) => g.rejectRate ?? 0));
  const anyInspected = data.grades.some((g) => g.inspectedCount > 0);
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3">
      {data.grades.map((g) => {
        const byProcess = g.byProcess.filter((p) => p.inspectedCount > 0);
        return (
          <div key={g.steelGradeId} className="grid grid-cols-[64px_minmax(0,1fr)_max-content] items-center gap-x-2.5 gap-y-0.5 text-xs">
            <b className="font-mono font-semibold">{g.steelGradeCode}</b>
            <div className="flex h-3.5 overflow-hidden rounded-xs bg-surface-3">{g.rejectRate ? <span className="bg-danger" style={{ width: pct(g.rejectRate, scale) }} /> : null}</div>
            <span className="text-right tabular-nums">
              <b className={cn('font-semibold', g.rejectRate ? 'text-danger' : undefined)}>{fmtPct(g.rejectRate, 1)}</b> <span className="text-cap text-ink-3">{g.failedCount}/{g.inspectedCount}건</span>
            </span>
            <span className="col-start-2 col-end-4 truncate text-cap text-ink-3">
              {byProcess.length > 0 ? byProcess.map((p) => `${PROCESS_TYPE_LABEL[p.processType]} ${p.failedCount}/${p.inspectedCount}`).join(' · ') : '판정된 검사 없음'}
            </span>
          </div>
        );
      })}
      <span className="text-cap text-ink-3">불합격률 = 불합격 ÷ 판정된 검사 수 · 막대 끝 = {Math.round(scale * 100)}%</span>
      {!anyInspected ? <WidgetEmpty>최근 {data.days}일 동안 판정된 검사가 없어요</WidgetEmpty> : null}
    </div>
  );
}

export function RejectRateWidget(props: WidgetProps) {
  const access = useDashboardWidgetAccess('REJECT_RATE');
  const query = useDashboardWidget('REJECT_RATE', access.allowed);
  return (
    <WidgetFrame widgetKey="REJECT_RATE" {...props} meta={query.data ? `최근 ${query.data.days}일 · ${fmtMD(query.data.from)}~${fmtMD(query.data.to)}` : null}>
      <WidgetBody allowed={access.allowed} permissions={access.permissions} query={query}>
        {(data) => <RejectRateBody data={data} />}
      </WidgetBody>
    </WidgetFrame>
  );
}

// ── 납기 위험 수주 ───────────────────────────────────────

function DeliveryRiskBody({ data }: { data: DeliveryRiskData }) {
  if (data.items.length === 0) return <WidgetEmpty>납기 위험 수주가 없어요</WidgetEmpty>;
  return (
    <Table compact className="min-w-[520px] [&_td]:px-2 [&_th]:sticky [&_th]:top-0 [&_th]:px-2">
      <thead>
        <tr>
          <Th>수주 번호</Th>
          <Th>고객사</Th>
          <Th>품목</Th>
          <Th align="right">출하 / 수주</Th>
          <Th align="right">미출하</Th>
          <Th title={`납기까지 ${data.deliveryRiskDays}일 이하이고 출하가 남은 품목`}>납기</Th>
        </tr>
      </thead>
      <tbody>
        {data.items.map((item) => (
          <tr key={item.salesOrderItemId} data-risk={item.isOverdue || undefined}>
            <Td className="font-mono text-xs font-medium">
              <Link href={`/sales-orders/${item.salesOrderId}`} className="text-run hover:underline">
                {item.salesOrderNo}
              </Link>{' '}
              <span className="text-cap text-ink-3">#{item.lineNo}</span>
            </Td>
            <Td className="max-w-28 truncate" title={item.customerName}>
              {item.customerName}
            </Td>
            <Td className="max-w-44 truncate font-mono text-xs" title={item.itemCode}>
              {item.itemCode}
            </Td>
            <Td align="right">
              {item.shippedQty} / {item.orderedQty}
            </Td>
            <Td align="right" title={fmtTon(item.unshippedTon)}>
              <b className="font-semibold">{item.unshippedQty}</b>
            </Td>
            <Td className={cn('font-semibold tabular-nums', item.isOverdue ? 'text-danger' : 'text-wait')}>
              <span className="inline-flex items-center gap-1">
                {item.isOverdue ? <Icon name="alert" size="sm" /> : null}
                {fmtMD(item.dueDate)} ({dueLabel(item.daysToDue)})
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function DeliveryRiskWidget(props: WidgetProps) {
  const access = useDashboardWidgetAccess('DELIVERY_RISK');
  const query = useDashboardWidget('DELIVERY_RISK', access.allowed);
  return (
    <WidgetFrame
      widgetKey="DELIVERY_RISK"
      {...props}
      meta={query.data ? `진행 중 품목 ${query.data.openItemCount}건 중 ${query.data.items.length}건 · 납기 ${query.data.deliveryRiskDays}일 이내` : null}
    >
      <WidgetBody allowed={access.allowed} permissions={access.permissions} query={query}>
        {(data) => <DeliveryRiskBody data={data} />}
      </WidgetBody>
    </WidgetFrame>
  );
}

// ── 구매 진행 ───────────────────────────────────────────

const REQUISITION_COLOR: Record<PurchaseRequisitionStatus, string> = {
  WAITING_APPROVAL: 'bg-[#c9731a]',
  APPROVED: 'bg-run',
  REJECTED: 'bg-danger',
  ORDERED: 'bg-ok',
};

function PurchaseProgressBody({ data }: { data: PurchaseProgressData }) {
  const statuses = data.requisitionsByStatus;
  const total = statuses?.reduce((s, r) => s + r.count, 0) ?? 0;
  const open = data.openPurchaseOrders;
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3">
      {statuses ? (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {statuses.map((s) => (
              <Figure key={s.status} label={`구매요청 ${PURCHASE_REQUISITION_STATUS_LABEL[s.status]}`} value={s.count} unit="건" tone={s.count ? undefined : 'muted'} />
            ))}
          </div>
          <div className="flex h-2 overflow-hidden rounded-xs bg-surface-3" aria-hidden="true">
            {statuses.map((s) => (s.count ? <span key={s.status} className={REQUISITION_COLOR[s.status]} style={{ width: pct(s.count, total) }} /> : null))}
          </div>
        </>
      ) : (
        <span className="flex items-center gap-1 text-cap text-ink-3">
          <Icon name="lock" size="sm" />
          구매요청은 구매요청 등록·MRP 조회 권한이 있어야 보여요
        </span>
      )}
      {open ? (
        <div className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-line pb-1.5">
            <span className="text-xs font-medium text-ink-2">입고가 남은 발주</span>
            <span className="ml-auto text-xs tabular-nums">
              <b>{open.count}</b>건 · 입고예정 <b>{fmtTon(open.scheduledReceiptTon)}</b>
            </span>
          </div>
          {open.purchaseOrders.map((po) => (
            <div key={po.purchaseOrderId} className="flex h-8 min-w-0 flex-none items-center gap-2 border-b border-line text-xs">
              <Link href={`/purchase-orders?po=${po.purchaseOrderId}`} className="flex-none font-mono font-medium text-run hover:underline">
                {po.purchaseOrderNo}
              </Link>
              <span className="min-w-0 truncate text-ink-2" title={`${po.supplierName} · ${po.lineCount}개 품목`}>
                {po.supplierName}
              </span>
              <span className="ml-auto flex-none tabular-nums">{fmtTon(po.scheduledReceiptTon)}</span>
              <span className="w-16 flex-none text-right text-cap text-ink-3 tabular-nums">{po.expectedReceiptDate ? `입고 ${fmtMD(po.expectedReceiptDate)}` : '예정일 없음'}</span>
            </div>
          ))}
          {open.purchaseOrders.length === 0 ? <WidgetEmpty>입고가 남은 발주가 없어요</WidgetEmpty> : null}
        </div>
      ) : (
        <span className="flex items-center gap-1 text-cap text-ink-3">
          <Icon name="lock" size="sm" />
          발주는 발주 조회 권한이 있어야 보여요
        </span>
      )}
    </div>
  );
}

export function PurchaseProgressWidget(props: WidgetProps) {
  const access = useDashboardWidgetAccess('PURCHASE_PROGRESS');
  const query = useDashboardWidget('PURCHASE_PROGRESS', access.allowed);
  const open = query.data?.openPurchaseOrders;
  return (
    <WidgetFrame widgetKey="PURCHASE_PROGRESS" {...props} meta={open ? `입고가 남은 발주 ${open.count}건` : null}>
      <WidgetBody allowed={access.allowed} permissions={access.permissions} query={query}>
        {(data) => <PurchaseProgressBody data={data} />}
      </WidgetBody>
    </WidgetFrame>
  );
}

// ── 출하 실적 ───────────────────────────────────────────

function ShipmentResultBody({ data }: { data: ShipmentResultData }) {
  return (
    <div className="flex flex-1 flex-col gap-2.5 px-4 py-3">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <Figure label="출고 확정" value={fmtInt(data.issuedRequestCount)} unit="건" />
        <Figure label="슬래브" value={fmtInt(data.totalSlabQty)} unit="매" />
        <Figure label="코일" value={fmtInt(data.totalCoilQty)} unit="개" />
        <Figure label="출고 중량" value={fmtTon(data.totalTon)} />
      </div>
      <DailyBars points={data.series} />
      {data.totalSlabQty + data.totalCoilQty === 0 ? <WidgetEmpty>최근 {data.days}일 동안 출고가 없어요</WidgetEmpty> : null}
    </div>
  );
}

export function ShipmentResultWidget(props: WidgetProps) {
  const access = useDashboardWidgetAccess('SHIPMENT_RESULT');
  const query = useDashboardWidget('SHIPMENT_RESULT', access.allowed);
  return (
    <WidgetFrame widgetKey="SHIPMENT_RESULT" {...props} meta={query.data ? `최근 ${query.data.days}일 · 출고 확정일 기준` : null}>
      <WidgetBody allowed={access.allowed} permissions={access.permissions} query={query}>
        {(data) => <ShipmentResultBody data={data} />}
      </WidgetBody>
    </WidgetFrame>
  );
}

// ── 여재 보유 기간 ───────────────────────────────────────

function SurplusAgeBody({ data }: { data: SurplusAgeData }) {
  const maxAge = Math.max(1, data.maxAgeDays ?? 0);
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <Figure label="여재" value={fmtInt(data.totalQty)} unit="매" />
        <Figure label="중량" value={fmtTon(data.totalTon)} />
        <Figure label="최장 보유" value={data.maxAgeDays === null ? '—' : fmtInt(data.maxAgeDays)} unit={data.maxAgeDays === null ? undefined : '일'} />
      </div>
      <div className="flex flex-col border-t border-line">
        {data.items.map((item) => (
          <div key={item.itemId} className="flex h-8 min-w-0 flex-none items-center gap-2 border-b border-line text-xs" title={`${item.itemCode} · ${fmtTon(item.surplusTon)} · ${item.oldestSinceDate}부터`}>
            <span className="min-w-0 flex-1 truncate font-mono">{item.itemCode}</span>
            <span className="flex-none tabular-nums">{item.surplusQty}매</span>
            <div className="h-1.5 w-16 flex-none overflow-hidden rounded-[3px] bg-surface-3">
              <span className="block h-full bg-[#c9731a]" style={{ width: pct(item.maxAgeDays, maxAge) }} />
            </div>
            <b className="w-10 flex-none text-right font-semibold tabular-nums">{item.maxAgeDays}일</b>
          </div>
        ))}
        {data.items.length === 0 ? <WidgetEmpty>여재 슬래브가 없어요</WidgetEmpty> : null}
      </div>
      <span className="text-cap text-ink-3">여재 = 수주에 쓰이지 않고 남은 미배정 합격 슬래브 (재고 화면 여재와 같은 값) · 보유 일수 = 여재로 바뀐 날부터</span>
    </div>
  );
}

export function SurplusAgeWidget(props: WidgetProps) {
  const access = useDashboardWidgetAccess('SURPLUS_AGE');
  const query = useDashboardWidget('SURPLUS_AGE', access.allowed);
  return (
    <WidgetFrame widgetKey="SURPLUS_AGE" {...props} meta={query.data ? `규격 ${query.data.items.length}개 · 오래된 순` : null}>
      <WidgetBody allowed={access.allowed} permissions={access.permissions} query={query}>
        {(data) => <SurplusAgeBody data={data} />}
      </WidgetBody>
    </WidgetFrame>
  );
}

// ── 생산량 ──────────────────────────────────────────────

function ProductionVolumeBody({ data }: { data: ProductionVolumeData }) {
  return (
    <div className="flex flex-1 flex-col gap-2.5 px-4 py-3">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <Figure label="슬래브" value={fmtInt(data.totalSlabQty)} unit="매" />
        <Figure label="코일" value={fmtInt(data.totalCoilQty)} unit="개" />
        <Figure label="생산 중량" value={fmtTon(data.totalTon)} />
      </div>
      <DailyBars points={data.series} />
      {data.totalSlabQty + data.totalCoilQty === 0 ? <WidgetEmpty>최근 {data.days}일 동안 생산이 없어요</WidgetEmpty> : null}
    </div>
  );
}

export function ProductionVolumeWidget(props: WidgetProps) {
  const access = useDashboardWidgetAccess('PRODUCTION_VOLUME');
  const query = useDashboardWidget('PRODUCTION_VOLUME', access.allowed);
  return (
    <WidgetFrame widgetKey="PRODUCTION_VOLUME" {...props} meta={query.data ? `최근 ${query.data.days}일 · 생산완료일 기준` : null}>
      <WidgetBody allowed={access.allowed} permissions={access.permissions} query={query}>
        {(data) => <ProductionVolumeBody data={data} />}
      </WidgetBody>
    </WidgetFrame>
  );
}
