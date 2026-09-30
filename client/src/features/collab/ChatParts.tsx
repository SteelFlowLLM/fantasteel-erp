// 메신저 화면의 작은 부품: 방 아이콘, 메시지 본문(멘션·ERP 링크), 파일, 시스템 메시지, 메시지 한 건.
// 모양은 v1 B안(31 메신저·업무방)의 마크업·클래스를 따른다.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { DRAFT_STATUS_LABEL, type DraftStatus, type SalesOrderStatus } from '@fantasteel/shared';
import { fileUrl } from '@/api/client';
import type { ActionDraftBrief, ChatRoomView, MessageLink, MessageView } from '@/api/messenger';
import { Badge, ComingSoon, Icon, type Tone } from '@/components/ui';
import { fmtBytes, fmtDate, fmtHM, fmtMD, fmtMDdow, todayStr } from '@/lib/format';

export const SALES_ORDER_STATUS_TONE: Record<SalesOrderStatus, Tone> = {
  REGISTERED: 'neutral', IN_PROGRESS: 'run', PARTIALLY_SHIPPED: 'wait', SHIPPED: 'ok', CANCELLED: 'danger',
};
export const DRAFT_STATUS_TONE: Record<DraftStatus, Tone> = { AI_GENERATED: 'neutral', WAITING_APPROVAL: 'wait', APPROVED: 'run', EXECUTED: 'ok', REJECTED: 'danger' };
/** 처리가 끝나지 않은 초안 — 같은 메시지로 다시 만들면 서버가 이것을 돌려준다. */
export const isOpenDraft = (d: ActionDraftBrief) => d.draftStatus !== 'EXECUTED' && d.draftStatus !== 'REJECTED';

const yesterdayStr = () => fmtDate(new Date(Date.now() - 86_400_000));

/** 날짜 구분선 라벨: 오늘 · 어제 · 09-30 (수) */
export function dayLabel(at: string): string {
  const day = fmtDate(at);
  if (day === todayStr()) return '오늘';
  if (day === yesterdayStr()) return '어제';
  return fmtMDdow(at);
}
/** 목록용 시각: 오늘이면 14:05, 어제면 '어제', 그 전은 09-30 */
export function smartTime(at: string | null | undefined): string {
  if (!at) return '';
  const day = fmtDate(at);
  if (day === todayStr()) return fmtHM(at);
  if (day === yesterdayStr()) return '어제';
  return fmtMD(at);
}

export function RoomIcon({ room, active, big }: { room: ChatRoomView; active?: boolean; big?: boolean }) {
  const size = big ? { width: 34, height: 34 } : undefined;
  if (room.chatRoomType === 'DIRECT') return <span className="hl-avatar" style={size}>{room.displayName.slice(0, 1)}</span>;
  const work = room.chatRoomType === 'WORK';
  const tone = work || active ? { background: active ? '#D5E1EC' : '#E7EEF5', color: '#173A5E' } : undefined;
  return (
    <span className="hl-chan" style={{ ...size, ...tone }}>
      <Icon name={work ? 'order' : 'hash'} size={big ? undefined : 'sm'} />
    </span>
  );
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 메시지 본문: @멘션을 강조하고, 서버가 준 ERP 번호(links)를 화면 링크로 바꾼다 (REQ-MSG-006). */
export function RichText({ text, links = [], mentionNames = [] }: { text: string; links?: MessageLink[]; mentionNames?: string[] }) {
  const linkOf = new Map(links.map((l) => [l.label, l.linkPath]));
  const tokens = [...new Set([...linkOf.keys(), ...mentionNames.map((n) => `@${n}`)])].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!tokens.length) return <>{text}</>;
  return (
    <>
      {text.split(new RegExp(`(${tokens.map(esc).join('|')})`)).map((part, i) => {
        if (i % 2 === 0) return part || null;
        const to = linkOf.get(part);
        return to ? <Link key={i} className="hl-link-id" to={to}>{part}</Link> : <span key={i} className="hl-mention hl-mention--user">{part}</span>;
      })}
    </>
  );
}

const LINK_KIND: { prefix: string; icon: string; label: string }[] = [
  { prefix: '/sales-orders/', icon: 'gauge', label: '수주 상세' },
  { prefix: '/purchase-requisitions/', icon: 'cart', label: '구매요청 보기' },
  { prefix: '/lots/trace', icon: 'trace', label: 'LOT 추적' },
];

/** 메시지 아래의 "→ 수주 상세" 이동 링크 (v1의 hl-msg-action). */
function LinkActions({ links }: { links: MessageLink[] }) {
  const seen = new Set<string>();
  const uniq = links.filter((l) => !seen.has(l.linkPath) && seen.add(l.linkPath)).slice(0, 3);
  if (!uniq.length) return null;
  return (
    <div className="hl-row" style={{ gap: 12, flexWrap: 'wrap' }}>
      {uniq.map((l) => {
        const kind = LINK_KIND.find((k) => l.linkPath.startsWith(k.prefix));
        return (
          <Link key={l.linkPath} className="hl-msg-action" to={l.linkPath}>
            <Icon name={kind?.icon ?? 'link'} size="sm" />
            {kind?.label ?? '화면 열기'} <span className="mono">{l.label}</span> →
          </Link>
        );
      })}
    </div>
  );
}

const fileExt = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toUpperCase() : '파일');

export function FileChip({ message }: { message: MessageView }) {
  const f = message.file;
  if (!f) return null;
  return (
    <span className="hl-file">
      <Icon name="file" />
      <span className="hl-col">
        <b style={{ fontSize: 12.5, fontWeight: 600, wordBreak: 'break-all' }}>{f.fileName}</b>
        <span className="hl-cap">{fmtBytes(f.fileSize)} · {fileExt(f.fileName)}</span>
      </span>
      <a className="hl-iconbtn hl-iconbtn--sm" href={fileUrl(`/messages/${message.id}/file`)} download={f.fileName} aria-label={`${f.fileName} 내려받기`} title="내려받기">
        <Icon name="download" />
      </a>
    </span>
  );
}

export function SystemLine({ message }: { message: MessageView }) {
  return (
    <div className="hl-chat-system" id={`msg-${message.id}`}>
      <span style={{ background: '#EEF1F4', color: '#3F4A57' }}>
        <Icon name="info" size="sm" />
        <span>SYSTEM · <RichText text={message.content} links={message.links} /> · {fmtHM(message.createdAt)}</span>
      </span>
    </div>
  );
}

interface MessageItemProps {
  message: MessageView;
  room: ChatRoomView;
  myEmployeeId: number;
  /** 이 메시지에서 만든 초안 (있으면) */
  draft?: ActionDraftBrief;
  /** 구매요청 초안을 만들 권한(PURCHASE_REQUISITION_CREATE USE)이 있는지 */
  canCreateDraft: boolean;
  creatingDraft: boolean;
  onCreateDraft: (message: MessageView) => void;
}

/** 사람이 보낸 메시지 한 건 (hl-chat-msg). 위에 마우스를 올리면 Message → ERP 동작이 보인다. */
export function MessageItem({ message: m, room, myEmployeeId, draft, canCreateDraft, creatingDraft, onCreateDraft }: MessageItemProps) {
  const mine = m.senderId === myEmployeeId;
  const sender = room.members.find((x) => x.employeeId === m.senderId);
  const name = m.senderName ?? sender?.employeeName ?? '알 수 없음';
  const mentionNames = room.members.filter((x) => m.mentionEmployeeIds.includes(x.employeeId)).map((x) => x.employeeName);
  const isFile = m.messageType === 'FILE' && !!m.file;
  const text = isFile && m.content === m.file?.fileName ? '' : m.content;
  const openDraft = draft && isOpenDraft(draft) ? draft : undefined;
  let bar: ReactNode = null;
  if (m.messageType === 'TEXT' && canCreateDraft) {
    bar = (
      <div className="msgr-msg__bar">
        {openDraft ? (
          <Link className="hl-btn hl-btn--sm" to={`/action-drafts/${openDraft.id}`}><Icon name="cart" size="sm" />초안 보기</Link>
        ) : (
          <button type="button" className="hl-btn hl-btn--sm" disabled={creatingDraft} onClick={() => onCreateDraft(m)}>
            <Icon name="cart" size="sm" />
            {creatingDraft ? '초안 만드는 중…' : '구매요청 초안 만들기'}
          </button>
        )}
        <span title="AI 자동 추출은 포함되지 않아요. 초안의 값은 요청자가 직접 입력해요" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 4px' }}>
          <span className="hl-cap">AI 자동 추출</span>
          <ComingSoon grade="AI" />
        </span>
      </div>
    );
  }
  return (
    <div className={`msgr-msg${m.mentionEmployeeIds.includes(myEmployeeId) ? ' is-mentioned' : ''}`} id={`msg-${m.id}`}>
      {bar}
      <div className="hl-chat-msg">
        <span className={`hl-avatar hl-avatar--lg${mine ? ' hl-avatar--s' : ''}`}>{name.slice(0, 1)}</span>
        <div className="hl-col" style={{ gap: 4, alignItems: 'flex-start', minWidth: 0 }}>
          <div className="hl-chat-msg__meta">
            <b>{name}</b>
            <span className="hl-cap">{sender ? `${sender.departmentName} · ${sender.jobGrade}` : ''}{mine ? ' · 나' : ''}</span>
            <time dateTime={m.createdAt}>{fmtHM(m.createdAt)}</time>
          </div>
          {text ? <div className="hl-chat-msg__text msgr-text"><RichText text={text} links={m.links} mentionNames={mentionNames} /></div> : null}
          {isFile ? <FileChip message={m} /> : null}
          <LinkActions links={m.links} />
          {draft ? (
            <div className="hl-row" style={{ gap: 8, fontSize: 12 }}>
              <Badge tone={DRAFT_STATUS_TONE[draft.draftStatus]}>{DRAFT_STATUS_LABEL[draft.draftStatus]}</Badge>
              <Link className="hl-msg-action" to={`/action-drafts/${draft.id}`}>구매요청 초안 보기 →</Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
