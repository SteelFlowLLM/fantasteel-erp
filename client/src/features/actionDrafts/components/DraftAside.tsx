// 초안 화면 오른쪽: 원본 메시지 · 확정하면 · 초안 업무 유형(추출 스키마·실행 핸들러 등록부, REQ-ACT-004 · ACT-005 P2)
import Link from 'next/link';
import { ACTION_TYPE_CATALOG, type DraftDetailView } from '@/api/actionDrafts';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { ButtonLink } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { ComingSoon } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { fmtDateTime } from '@/lib/format';

export function OriginMessageCard({ draft }: { draft: DraftDetailView }) {
  const message = draft.message;
  return (
    <Card>
      <CardHead title="원본 메시지" />
      <CardBody className="gap-2.5 px-3.5 py-3">
        {message ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface-2 px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-cap text-ink-3">
              <Icon name="chat" size="sm" />
              <span className="truncate">{draft.chatRoomLabel ?? '채팅방'}</span>
            </span>
            <span className="flex items-center gap-2">
              <Avatar name={message.senderName ?? '?'} size="sm" />
              <b className="text-sm font-semibold">{message.senderName ?? '알 수 없는 사원'}</b>
              <span className="text-cap text-ink-3">{fmtDateTime(message.createdAt)}</span>
            </span>
            <p className="text-sm break-words whitespace-pre-wrap text-ink">“{message.content ?? ''}”</p>
            <ButtonLink href={`/messenger?room=${message.chatRoomId}`} size="sm" icon="chat" className="self-start">
              원본 메시지로 이동
            </ButtonLink>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-2.5 text-sm text-ink-3">
            <Icon name="info" size="sm" />
            원본 메시지를 불러올 수 없어요
          </div>
        )}
        <span className="text-cap text-ink-3">메시지를 보면서 왼쪽 값을 직접 입력해 주세요.</span>
      </CardBody>
    </Card>
  );
}

export function ConfirmGuideCard({ draft }: { draft: DraftDetailView }) {
  const pr = draft.purchaseRequisition;
  return (
    <Card>
      <CardHead title="확정하면" />
      <CardBody className="gap-2.5 px-3.5 py-3 text-xs">
        <div className="flex items-start gap-2">
          <Badge tone="run" plain className="flex-none">
            확정
          </Badge>
          <span>입력한 값으로 구매요청이 만들어져요 (출처: Message → ERP)</span>
        </div>
        <div className="flex items-start gap-2">
          <Badge tone="ok" plain className="flex-none">
            ERP 반영
          </Badge>
          <span>
            {pr ? (
              <>
                구매요청{' '}
                <Link href={`/purchase-requisitions/${pr.id}`} className="font-mono font-semibold text-brand hover:underline">
                  {pr.purchaseRequisitionNo}
                </Link>
              </>
            ) : (
              '구매요청 번호가 생겨요'
            )}
          </span>
        </div>
        <div className="flex items-start gap-2">
          <Badge tone="wait" plain className="flex-none">
            승인 대기
          </Badge>
          <span>요청자 소속 부서의 부서장이 승인해야 발주할 수 있어요</span>
        </div>
        <span className="text-cap text-ink-3">확정 뒤에는 초안을 고칠 수 없어요. 구매요청이 반려되면 구매요청 화면에서 고쳐 다시 요청해요.</span>
      </CardBody>
    </Card>
  );
}

/** 초안 업무 유형 등록부: 유형마다 추출 스키마 + 실행 핸들러. 지금은 구매요청 생성만 쓸 수 있다. */
export function ActionTypeCard({ current }: { current: DraftDetailView['actionType'] }) {
  return (
    <Card>
      <CardHead title="초안 업무 유형" />
      <CardBody flush>
        <ul className="flex flex-col">
          {ACTION_TYPE_CATALOG.map((entry) => (
            <li key={entry.actionType} className="flex flex-col gap-0.5 border-b border-line px-3.5 py-2 last:border-b-0">
              <span className="flex items-center gap-2 text-sm">
                <span className={entry.active ? 'font-semibold text-ink' : 'text-ink-3'}>{entry.label}</span>
                {entry.actionType === current ? (
                  <Badge tone="outline" className="ml-auto">
                    이 초안
                  </Badge>
                ) : entry.active ? null : (
                  <ComingSoon grade="P2" className="ml-auto" />
                )}
              </span>
              {entry.active ? <span className="text-cap text-ink-3">추출 스키마 · {entry.fieldLabels.join(' · ')}</span> : null}
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-3.5 py-2 text-cap text-ink-3">업무 유형마다 추출 스키마와 실행 핸들러를 등록해 유형을 늘려요.</p>
      </CardBody>
    </Card>
  );
}
