// 업무방 상단 수주 정보 (REQ-MSG-001 "업무방은 수주에 연결하고 상단에 수주 정보를 표시", REQ-MSG-006 수주 화면 이동)
import Link from 'next/link';
import { ITEM_TYPE_LABEL } from '@/codes';
import type { ChatRoomDetailView, WorkRoomSalesOrderItemView } from '@/api/messenger';
import { ButtonLink } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { formatItemQty } from '@/features/messenger/lib/salesOrderQty';
import { SalesOrderStatusBadge } from '@/features/sales/components/SalesOrderParts';
import { dLabel, fmtTon } from '@/lib/format';

/** 수주 요약을 못 보일 때의 안내 */
export function salesOrderStateNote(room: ChatRoomDetailView): string | null {
  if (room.salesOrderState === 'denied') return '수주 조회 권한이 없어 수주 정보를 볼 수 없어요';
  if (room.salesOrderState === 'missing') return '연결된 수주를 찾지 못했어요';
  return null;
}

/** 대화 위에 고정하는 한 줄 + 품목 줄 */
export function WorkRoomPin({ room }: { room: ChatRoomDetailView }) {
  const note = salesOrderStateNote(room);
  if (room.chatRoomType !== 'WORK') return null;
  if (!room.salesOrder) {
    return (
      <div className="flex flex-none items-center gap-2 border-b border-line bg-surface-2 px-5 py-2.5 text-xs text-ink-3">
        <Icon name="info" size="sm" />
        {note}
      </div>
    );
  }
  const salesOrder = room.salesOrder;
  return (
    <div className="flex flex-none flex-col gap-1.5 border-b border-line bg-brand-tint/50 px-5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="clipboard" size="sm" className="text-brand" />
          수주
          <Link href={salesOrder.linkPath} className="font-mono font-semibold text-brand hover:underline">
            {salesOrder.salesOrderNo}
          </Link>
          · {salesOrder.customerName}
        </span>
        {salesOrder.dueDate ? (
          <span className="text-xs text-ink-2">
            납기 {salesOrder.dueDate} ({dLabel(salesOrder.dueDate)})
          </span>
        ) : null}
        {salesOrder.cancelledAt ? <SalesOrderStatusBadge status="CANCELLED" /> : null}
        <ButtonLink href={salesOrder.linkPath} size="sm" className="ml-auto">
          수주 상세
        </ButtonLink>
      </div>
      {salesOrder.items.map((item) => (
        <SalesOrderItemLine key={item.id} item={item} />
      ))}
    </div>
  );
}

function SalesOrderItemLine({ item }: { item: WorkRoomSalesOrderItemView }) {
  const qty = formatItemQty(item);
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
      <span className="font-mono text-ink-3">{item.lineNo}</span>
      <span>{ITEM_TYPE_LABEL[item.itemType]}</span>
      <span className="font-mono">{item.itemCode}</span>
      <span>
        · {qty.ordered}{item.orderedTon ? ` (${fmtTon(item.orderedTon)})` : ''} · 출고 {qty.shipped}
      </span>
      <SalesOrderStatusBadge status={item.salesOrderItemStatus} />
    </div>
  );
}

/** 방 정보 칸의 수주 요약 */
export function WorkRoomSummary({ room }: { room: ChatRoomDetailView }) {
  const salesOrder = room.salesOrder;
  if (!salesOrder) return <p className="text-xs text-ink-3">{salesOrderStateNote(room)}</p>;
  return (
    <div className="flex flex-col gap-2.5">
      <dl className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1.5 text-xs">
        <dt className="text-ink-3">수주번호</dt>
        <dd>
          <Link href={salesOrder.linkPath} className="font-mono font-semibold text-brand hover:underline">
            {salesOrder.salesOrderNo}
          </Link>
        </dd>
        <dt className="text-ink-3">고객사</dt>
        <dd>{salesOrder.customerName}</dd>
        <dt className="text-ink-3">납기</dt>
        <dd>{salesOrder.dueDate ? `${salesOrder.dueDate} (${dLabel(salesOrder.dueDate)})` : '-'}</dd>
        <dt className="text-ink-3">담당</dt>
        <dd>{salesOrder.ownerName}</dd>
        <dt className="text-ink-3">품목</dt>
        <dd>{salesOrder.items.length}품목</dd>
      </dl>
      <ul className="flex flex-col gap-2">
        {salesOrder.items.map((item) => {
          const qty = formatItemQty(item);
          return (
          <li key={item.id} className="flex flex-col gap-0.5 rounded-sm border border-line bg-surface-2 px-2.5 py-2 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-ink-3">{item.lineNo}</span>
              <b className="font-semibold">{ITEM_TYPE_LABEL[item.itemType]}</b>
              {item.steelGradeCode ? <span className="text-ink-2">{item.steelGradeCode}</span> : null}
              <span className="ml-auto">
                <SalesOrderStatusBadge status={item.salesOrderItemStatus} />
              </span>
            </span>
            <span className="font-mono text-ink-2">{item.itemCode}</span>
            <span className="text-ink-3">
              수주 {qty.ordered}{item.orderedTon ? ` · ${fmtTon(item.orderedTon)}` : ''} · 출고 {qty.shipped} · 납기 {item.dueDate}
            </span>
          </li>
          );
        })}
      </ul>
      <ButtonLink href={salesOrder.linkPath} size="sm">
        수주 상세
      </ButtonLink>
    </div>
  );
}
