'use client';

// 수주 상세 · 이력 탭 (REQ-LOG-003): 이 수주의 작업 로그를 시간순으로(이력 재현).
// 작업 로그 화면과 같은 부품(EventTimeline, business_event.sales_order_id 기준)을 쓴다. 전체 검색·필터는 작업 로그 화면에서 한다.
import { ButtonLink } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { EventTimeline } from '@/features/businessEvents/components/EventTimeline';
import { businessEventsHref } from '@/features/sales/components/SalesOrderParts';

export function HistoryTab({ salesOrderId }: { salesOrderId: number }) {
  return (
    <Card>
      <CardHead
        title="이력"
        meta="시간순 · 이 수주에 남은 작업 로그"
        actions={
          <ButtonLink size="sm" icon="history" href={businessEventsHref(salesOrderId)}>
            작업 로그에서 보기
          </ButtonLink>
        }
      />
      <CardBody>
        <EventTimeline filter={{ salesOrderId }} emptyText="기록된 작업이 없어요" />
      </CardBody>
    </Card>
  );
}
