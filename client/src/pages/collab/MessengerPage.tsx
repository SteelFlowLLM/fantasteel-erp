// 메신저 (REQ-MSG-001~006, BP-MSG-01) + Message → ERP 구매요청 초안 만들기 (SPEC 9장 #2).
// 모양은 v1 B안 31(메신저·업무방): 방 목록 | 대화 | 방 정보.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CHAT_ROOM_TYPE_LABEL, ITEM_QTY_UNIT, ITEM_TYPE_LABEL, SALES_ORDER_STATUS_LABEL, type ChatRoomType } from '@fantasteel/shared';
import { messageActionApi, messengerApi, type ActionDraftBrief, type ChatRoomView, type MessageView } from '@/api/messenger';
import { queryClient } from '@/api/queryClient';
import { Badge, ComingSoon, EmptyNote, Icon, QueryBoundary, StateView } from '@/components/ui';
import { ChatComposer } from '@/features/collab/ChatComposer';
import { FileChip, MessageItem, RoomIcon, SALES_ORDER_STATUS_TONE, SystemLine, dayLabel, isOpenDraft, smartTime } from '@/features/collab/ChatParts';
import { appendMessageToCache, applyReadState, chatKeys, setActiveChatReader, type MessagePages } from '@/features/collab/chatCache';
import { InviteModal, LeaveModal, NewRoomModal } from '@/features/collab/RoomModals';
import { useAction } from '@/hooks/useApi';
import { useRealtimeEvent } from '@/hooks/useRealtime';
import { dLabel, fmtDate, fmtMD, fmtTon } from '@/lib/format';
import { useShellTitle } from '@/shell/shellTitle';
import { canUse, useMe } from '@/stores/auth';
import './MessengerPage.css';

type Seg = 'all' | 'unread' | ChatRoomType;
const SECTION_ORDER: ChatRoomType[] = ['WORK', 'GROUP', 'DIRECT'];
const itemTypeName = (itemType: string) => (ITEM_TYPE_LABEL as Record<string, string>)[itemType] ?? itemType;
const itemUnit = (itemType: string) => (ITEM_QTY_UNIT as Record<string, string>)[itemType] ?? '';
/** 맨 아래에서 이 거리(px) 안이면 "맨 아래를 보고 있다"로 친다 */
const BOTTOM_SLACK = 48;

const isWindowActive = () => document.visibilityState === 'visible' && document.hasFocus();

function roomCaption(room: ChatRoomView, myEmployeeId: number): string {
  if (room.chatRoomType === 'DIRECT') {
    const other = room.members.find((m) => m.employeeId !== myEmployeeId);
    return `1:1${other ? ` · ${other.departmentName} · ${other.jobGrade}` : ''}`;
  }
  if (room.chatRoomType === 'WORK') return `수주 연결 업무방 · 멤버 ${room.memberCount}`;
  const depts = [...new Set(room.members.map((m) => m.departmentName))];
  return `그룹 · ${depts.slice(0, 3).join('·')}${depts.length > 3 ? ' 외' : ''} · 멤버 ${room.memberCount}`;
}

function lastLine(room: ChatRoomView, myEmployeeId: number): string {
  const last = room.lastMessage;
  if (!last) return '아직 대화가 없어요';
  const body = last.messageType === 'FILE' ? `파일 · ${last.preview}` : last.preview;
  if (last.messageType === 'SYSTEM' || room.chatRoomType === 'DIRECT') return last.senderId === myEmployeeId ? `나: ${body}` : body;
  return `${last.senderId === myEmployeeId ? '나' : last.senderName ?? ''}: ${body}`;
}

// ───────────────────────────── 방 목록 ─────────────────────────────
function RoomList({ rooms, roomId, myEmployeeId, onNew }: { rooms: ChatRoomView[]; roomId: number | null; myEmployeeId: number; onNew: () => void }) {
  const [q, setQ] = useState('');
  const [seg, setSeg] = useState<Seg>('all');
  const totalUnread = rooms.reduce((sum, r) => sum + r.unreadCount, 0);
  const keyword = q.trim().toLowerCase();
  const shown = rooms.filter((r) => {
    if (seg === 'unread' ? !r.unreadCount : seg !== 'all' && r.chatRoomType !== seg) return false;
    if (!keyword) return true;
    const hay = [r.displayName, r.salesOrder?.salesOrderNo, r.salesOrder?.customerName, r.lastMessage?.preview, ...r.members.map((m) => m.employeeName)];
    return hay.some((s) => s?.toLowerCase().includes(keyword));
  });
  const count = (t: ChatRoomType) => rooms.filter((r) => r.chatRoomType === t).length;
  const segs: [Seg, string][] = [
    ['all', '전체'], ['unread', `안 읽음 ${totalUnread}`],
    ['DIRECT', CHAT_ROOM_TYPE_LABEL.DIRECT], ['GROUP', CHAT_ROOM_TYPE_LABEL.GROUP], ['WORK', `${CHAT_ROOM_TYPE_LABEL.WORK} ${count('WORK')}`],
  ];
  // 전체 보기에서는 업무방 · 그룹 · 1:1로 묶고, 묶음 안은 서버가 준 최근 대화 순 그대로
  const groups: { key: string; label: string | null; rows: ChatRoomView[] }[] =
    seg === 'all'
      ? SECTION_ORDER.map((t) => ({ key: t, label: `${CHAT_ROOM_TYPE_LABEL[t]} ${shown.filter((r) => r.chatRoomType === t).length}`, rows: shown.filter((r) => r.chatRoomType === t) })).filter((g) => g.rows.length)
      : shown.length ? [{ key: seg, label: null, rows: shown }] : [];
  return (
    <section className="hl-master" aria-label="대화방 목록">
      <div className="hl-master__head">
        <div className="hl-row">
          <b style={{ fontSize: 15 }}>대화방</b>
          <span className="hl-cap">{rooms.length}개 · 안 읽음 {totalUnread}</span>
          <button type="button" className="hl-btn hl-btn--sm" style={{ marginLeft: 'auto' }} onClick={onNew}><Icon name="plus" />새 대화</button>
        </div>
        <label className="hl-search" style={{ width: '100%', height: 32 }}>
          <Icon name="search" size="sm" />
          <input type="search" placeholder="방 이름·수주번호·멤버 검색" aria-label="대화방 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="hl-seg" role="group" aria-label="대화방 필터" style={{ alignSelf: 'flex-start', maxWidth: '100%', overflowX: 'auto' }}>
          {segs.map(([key, label]) => (
            <button key={key} type="button" className={seg === key ? 'is-on' : undefined} aria-pressed={seg === key} style={{ whiteSpace: 'nowrap', padding: '0 8px' }} onClick={() => setSeg(key)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="hl-master__list">
        {groups.map((g) => (
          <Fragment key={g.key}>
            {g.label ? <div className="hl-nav-group" style={{ padding: '10px 16px 4px' }}>{g.label}</div> : null}
            {g.rows.map((r) => {
              const active = r.id === roomId;
              return (
                <Link key={r.id} className={`hl-mitem${active ? ' is-active' : ''}`} to={`/messenger?room=${r.id}`} aria-current={active ? 'true' : undefined}>
                  <div className="hl-row">
                    <RoomIcon room={r} active={active} />
                    <div className="hl-col hl-grow">
                      <div className="hl-row">
                        <b style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.displayName}</b>
                        {seg !== 'all' && seg !== r.chatRoomType ? <span className="hl-tag" style={{ flex: 'none' }}>{CHAT_ROOM_TYPE_LABEL[r.chatRoomType]}</span> : null}
                        <span className="hl-cap" style={{ marginLeft: 'auto', flex: 'none' }}>{smartTime(r.lastMessage?.createdAt ?? r.createdAt)}</span>
                      </div>
                      <div className="hl-row" style={{ gap: 6 }}>
                        <span className="hl-room__last hl-grow" style={r.unreadCount ? { color: 'var(--ink-2)' } : undefined}>{lastLine(r, myEmployeeId)}</span>
                        {r.unreadCount ? <span className="hl-room__badge" aria-label={`안 읽은 메시지 ${r.unreadCount}건`}>{r.unreadCount > 99 ? '99+' : r.unreadCount}</span> : null}
                      </div>
                    </div>
                  </div>
                  {r.salesOrder ? (
                    <div className="hl-row hl-cap" style={{ paddingLeft: 38 }}>
                      <span>{r.salesOrder.customerName}</span>
                      <span>· 납기 {fmtMD(r.salesOrder.dueDate)}</span>
                      <span>· {SALES_ORDER_STATUS_LABEL[r.salesOrder.salesOrderStatus]}</span>
                      <span>· 멤버 {r.memberCount}</span>
                    </div>
                  ) : null}
                </Link>
              );
            })}
          </Fragment>
        ))}
        {!groups.length ? <EmptyNote>{keyword || seg !== 'all' ? '조건에 맞는 대화방이 없어요' : '참여 중인 대화방이 없어요 · [새 대화]로 시작해 보세요'}</EmptyNote> : null}
      </div>
    </section>
  );
}

// ───────────────────────────── 업무방 수주 요약 (상단 고정) ─────────────────────────────
function OrderPin({ room }: { room: ChatRoomView }) {
  const so = room.salesOrder;
  if (!so) return null;
  return (
    <div className="hl-pin" style={{ flexWrap: 'wrap', rowGap: 4 }}>
      <Icon name="pin" />
      <span><span className="hl-muted">수주</span> <Link className="hl-link-id" to={so.linkPath}>{so.salesOrderNo}</Link> · <b>{so.customerName}</b></span>
      <span><span className="hl-muted">납기</span> <b className="tnum">{fmtDate(so.dueDate)}</b> <span className="hl-muted">({dLabel(so.dueDate)})</span></span>
      <Badge tone={SALES_ORDER_STATUS_TONE[so.salesOrderStatus]}>{SALES_ORDER_STATUS_LABEL[so.salesOrderStatus]}</Badge>
      <Link className="hl-btn hl-btn--sm" to={so.linkPath} style={{ marginLeft: 'auto' }}><Icon name="gauge" />수주 상세</Link>
      <span className="hl-row hl-ink2" style={{ flexBasis: '100%', paddingLeft: 30, gap: '2px 14px', flexWrap: 'wrap' }}>
        {so.items.map((it) => (
          <span key={it.salesOrderItemId} className="tnum">
            <span className="hl-muted">{it.lineNo}</span> {itemTypeName(it.itemType)} <span className="mono">{it.specCode}</span> · {it.orderedQty}{itemUnit(it.itemType)} ({fmtTon(it.weightTon)}) · 출고 {it.shippedQty}
          </span>
        ))}
      </span>
    </div>
  );
}

// ───────────────────────────── 방 정보 (오른쪽) ─────────────────────────────
function RoomAside({ room, files, myEmployeeId, onInvite, onLeave }: { room: ChatRoomView; files: MessageView[]; myEmployeeId: number; onInvite: () => void; onLeave: () => void }) {
  const so = room.salesOrder;
  const canInvite = room.chatRoomType !== 'DIRECT';
  return (
    <aside className="msgr-aside" aria-label="방 정보">
      {so ? (
        <div className="msgr-aside__block">
          <div className="hl-row">
            <b style={{ fontSize: 13 }}>수주 요약</b>
            <Link className="hl-link-id" to={so.linkPath} style={{ marginLeft: 'auto' }}>{so.salesOrderNo}</Link>
          </div>
          <dl className="hl-kv" style={{ rowGap: 6 }}>
            <dt>고객사</dt>
            <dd>{so.customerName}</dd>
            <dt>납기</dt>
            <dd className="tnum">{fmtDate(so.dueDate)} <span className="hl-muted" style={{ fontWeight: 400 }}>{dLabel(so.dueDate)}</span></dd>
            <dt>상태</dt>
            <dd><Badge tone={SALES_ORDER_STATUS_TONE[so.salesOrderStatus]}>{SALES_ORDER_STATUS_LABEL[so.salesOrderStatus]}</Badge></dd>
            <dt>품목</dt>
            <dd className="tnum">{so.items.length}품목</dd>
          </dl>
          <div className="hl-col" style={{ gap: 8 }}>
            {so.items.map((it) => (
              <div key={it.salesOrderItemId} className="hl-col" style={{ gap: 2, fontSize: 12 }}>
                <div className="hl-row" style={{ gap: 6 }}>
                  <span className="hl-grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.lineNo} {itemTypeName(it.itemType)} <span className="mono">{it.steelGradeCode}</span></span>
                  <Badge tone={SALES_ORDER_STATUS_TONE[it.salesOrderItemStatus]}>{SALES_ORDER_STATUS_LABEL[it.salesOrderItemStatus]}</Badge>
                </div>
                <span className="hl-cap mono" style={{ wordBreak: 'break-all' }}>{it.specCode}</span>
                <span className="hl-cap tnum">주문 {it.orderedQty}{itemUnit(it.itemType)} · {fmtTon(it.weightTon)} · 출고 {it.shippedQty}{itemUnit(it.itemType)}</span>
              </div>
            ))}
          </div>
          <Link className="hl-btn hl-btn--primary hl-btn--sm" to={so.linkPath}>수주 상세</Link>
        </div>
      ) : (
        <div className="msgr-aside__block">
          <div className="hl-row">
            <b style={{ fontSize: 13 }}>방 정보</b>
            <span className="hl-tag" style={{ marginLeft: 'auto' }}>{CHAT_ROOM_TYPE_LABEL[room.chatRoomType]}</span>
          </div>
          <dl className="hl-kv" style={{ rowGap: 6 }}>
            <dt>이름</dt>
            <dd>{room.displayName}</dd>
            <dt>개설</dt>
            <dd className="tnum">{fmtDate(room.createdAt)}</dd>
          </dl>
        </div>
      )}
      <div className="msgr-aside__block">
        <div className="hl-row">
          <b style={{ fontSize: 13 }}>공유 파일</b>
          <span className="hl-cap">{files.length}</span>
          <span className="hl-cap" style={{ marginLeft: 'auto' }}>불러온 대화 기준</span>
        </div>
        {files.slice(-5).reverse().map((m) => (
          <div key={m.id} className="hl-col" style={{ gap: 2, alignItems: 'flex-start' }}>
            <FileChip message={m} />
            <span className="hl-cap">{m.senderName ?? ''} · {fmtMD(m.createdAt)}</span>
          </div>
        ))}
        {!files.length ? <span className="hl-cap">이 방에 공유된 파일이 없어요</span> : null}
      </div>
      <div className="msgr-aside__block" style={{ borderBottom: 0 }}>
        <div className="hl-row">
          <b style={{ fontSize: 13 }}>멤버</b>
          <span className="hl-cap">{room.memberCount}</span>
          {canInvite ? <button type="button" className="hl-btn hl-btn--sm" style={{ marginLeft: 'auto' }} onClick={onInvite}><Icon name="plus" />초대</button> : null}
        </div>
        {room.members.map((m) => (
          <div key={m.employeeId} className="hl-row" style={{ fontSize: 12.5 }}>
            <span className={`hl-avatar hl-avatar--sm${m.employeeId === myEmployeeId ? ' hl-avatar--s' : ''}`}>{m.employeeName.slice(0, 1)}</span>
            <span className="hl-grow">{m.employeeName} <span className="hl-cap">{m.jobGrade}{m.employeeId === myEmployeeId ? ' · 나' : ''}</span></span>
            <span className="hl-tag">{m.departmentName}</span>
          </div>
        ))}
        <div className="hl-row hl-cap" style={{ marginTop: 4 }}>
          <span className="hl-aimark hl-aimark--sm" style={{ width: 16, height: 16, fontSize: 8 }}>AI</span>
          AI 어시스턴트 (@AI 호출)
          <ComingSoon grade="P2" />
        </div>
        {room.chatRoomType === 'DIRECT' ? <span className="hl-cap">1:1 대화에는 멤버를 추가할 수 없어요. 그룹 대화를 새로 만들어 주세요</span> : null}
        {room.chatRoomType === 'GROUP' ? (
          <button type="button" className="hl-btn hl-btn--danger-outline hl-btn--sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={onLeave}><Icon name="logout" />그룹 나가기</button>
        ) : null}
      </div>
    </aside>
  );
}

// ───────────────────────────── 대화 ─────────────────────────────
function Conversation({ room }: { room: ChatRoomView }) {
  const me = useMe();
  const navigate = useNavigate();
  const myId = me.employeeId;
  const roomId = room.id;
  const [asideOpen, setAsideOpen] = useState(true);
  const [modal, setModal] = useState<'invite' | 'leave' | null>(null);
  const [newBelow, setNewBelow] = useState(0);

  const query = useInfiniteQuery({
    queryKey: chatKeys.messages(roomId),
    queryFn: ({ pageParam }) => messengerApi.messages(roomId, pageParam),
    initialPageParam: undefined as number | undefined,
    // 더 오래된 쪽: 그 페이지의 첫(가장 오래된) 메시지 id를 beforeId로
    getNextPageParam: (last) => (last.hasMore && last.items.length ? last.items[0].id : undefined),
  });
  const messages = useMemo(() => {
    const byId = new Map<number, MessageView>();
    for (const page of query.data?.pages ?? []) for (const m of page.items) byId.set(m.id, m);
    return [...byId.values()].sort((a, b) => a.id - b.id);
  }, [query.data]);
  const firstId = messages[0]?.id ?? null;
  const last = messages[messages.length - 1];
  const lastId = last?.id ?? null;
  const files = useMemo(() => messages.filter((m) => m.messageType === 'FILE' && m.file), [messages]);

  // Message → ERP: 이 방 메시지에서 만든 초안 (메시지 응답에는 초안 정보가 없어 초안 목록에서 찾는다)
  const canCreateDraft = canUse(me, 'PURCHASE_REQUISITION_CREATE');
  const drafts = useQuery({ queryKey: ['action-drafts', 'list'], queryFn: messageActionApi.drafts, retry: false });
  const draftByMessage = useMemo(() => {
    const map = new Map<number, ActionDraftBrief>();
    // 미처리 초안을 먼저, 없으면 가장 최근 초안
    for (const d of [...(drafts.data ?? [])].sort((a, b) => a.id - b.id)) {
      if (d.messageId === null) continue;
      const prev = map.get(d.messageId);
      if (!prev || !isOpenDraft(prev) || isOpenDraft(d)) map.set(d.messageId, d);
    }
    return map;
  }, [drafts.data]);
  const createDraft = useAction(messageActionApi.createDraft, {
    invalidate: ['action-drafts'],
    onSuccess: (draft) => navigate(`/action-drafts/${draft.id}`),
  });

  // ── 스크롤: 맨 아래를 보고 있을 때만 새 메시지를 따라간다
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const forceBottomRef = useRef(false);
  const prevRef = useRef<{ firstId: number | null; lastId: number | null; height: number }>({ firstId: null, lastId: null, height: 0 });

  // ── 읽음: 창에 포커스가 있고 맨 아래(최신 메시지)가 보일 때만 읽음 처리한다 (REQ-MSG-004)
  const markedRef = useRef(room.myLastReadMessageId ?? 0);
  const read = useMutation({ mutationFn: messengerApi.markRead, onSuccess: applyReadState });
  const readMutate = read.mutate;
  const stateRef = useRef({ messages, myId });
  stateRef.current = { messages, myId };
  const tryMarkRead = useCallback(() => {
    if (!isWindowActive() || !atBottomRef.current) return;
    const list = stateRef.current.messages;
    const latest = list[list.length - 1];
    if (!latest) return;
    // 남이 보낸 새 메시지(시스템 포함)가 없으면 부르지 않는다
    const hasNewFromOthers = list.some((m) => m.id > markedRef.current && m.senderId !== stateRef.current.myId);
    if (!hasNewFromOthers) return;
    const before = markedRef.current;
    markedRef.current = latest.id;
    readMutate({ id: roomId, lastReadMessageId: latest.id }, { onError: () => { markedRef.current = before; } });
  }, [readMutate, roomId]);

  useEffect(() => {
    setActiveChatReader((id) => id === roomId && isWindowActive() && atBottomRef.current);
    return () => setActiveChatReader(null);
  }, [roomId]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = prevRef.current;
    if (prev.lastId === null || forceBottomRef.current) {
      // 처음 열었거나 내가 보낸 직후
      el.scrollTop = el.scrollHeight;
      atBottomRef.current = true;
      forceBottomRef.current = false;
    } else if (lastId !== prev.lastId) {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
      else setNewBelow((n) => n + messages.filter((m) => m.id > (prev.lastId ?? 0) && m.senderId !== myId).length);
    } else if (firstId !== prev.firstId) {
      // 이전 메시지를 위에 붙였다 → 보던 자리를 지킨다
      el.scrollTop += el.scrollHeight - prev.height;
    }
    prevRef.current = { firstId, lastId, height: el.scrollHeight };
  }, [firstId, lastId, messages, myId]);

  // 새 메시지가 보이면 읽음 처리
  useEffect(() => {
    if (lastId !== null) tryMarkRead();
  }, [lastId, tryMarkRead]);
  useEffect(() => {
    window.addEventListener('focus', tryMarkRead);
    document.addEventListener('visibilitychange', tryMarkRead);
    return () => {
      window.removeEventListener('focus', tryMarkRead);
      document.removeEventListener('visibilitychange', tryMarkRead);
    };
  }, [tryMarkRead]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const loadOlder = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK;
    atBottomRef.current = atBottom;
    if (atBottom) {
      if (newBelow) setNewBelow(0);
      tryMarkRead();
    }
    if (el.scrollTop < 60) loadOlder();
  };
  const toBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setNewBelow(0);
    tryMarkRead();
  };
  const onSent = (m: MessageView) => {
    forceBottomRef.current = true;
    appendMessageToCache(m);
  };

  let prevDay = '';
  return (
    <>
      <main className="hl-main hl-main--flush msgr-main">
        <div className="hl-row msgr-head">
          <RoomIcon room={room} big />
          <div className="hl-col" style={{ minWidth: 0 }}>
            <b style={{ fontSize: 16, lineHeight: '22px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{room.displayName}</b>
            <span className="hl-cap">{roomCaption(room, myId)}</span>
          </div>
          <div className="hl-row" style={{ marginLeft: 'auto', gap: 4, flex: 'none' }}>
            {room.chatRoomType === 'WORK' ? <span className="hl-tag"><Icon name="link" size="sm" style={{ marginRight: 4 }} />수주 연결 업무방</span> : null}
            {room.chatRoomType !== 'DIRECT' ? <button type="button" className="hl-btn hl-btn--sm" onClick={() => setModal('invite')}><Icon name="users" />멤버 초대</button> : null}
            <button type="button" className="hl-iconbtn" aria-label="방 정보 열기·닫기" aria-pressed={asideOpen} style={asideOpen ? { background: '#EEF1F4' } : undefined} onClick={() => setAsideOpen(!asideOpen)}>
              <Icon name="panel" />
            </button>
          </div>
        </div>
        <OrderPin room={room} />
        <div className="msgr-feed-wrap">
          <div className="msgr-feed" ref={scrollRef} onScroll={onScroll} role="log" aria-label={`${room.displayName} 대화`}>
            <QueryBoundary query={query} loadingLabel="대화를 불러오는 중…">
              {() => (
                <>
                  {hasNextPage ? (
                    <div className="hl-row" style={{ justifyContent: 'center' }}>
                      <button type="button" className="hl-btn hl-btn--ghost hl-btn--sm" disabled={isFetchingNextPage} onClick={loadOlder}>
                        <Icon name="chevron-up" size="sm" />
                        {isFetchingNextPage ? '불러오는 중…' : '이전 메시지 더 보기'}
                      </button>
                    </div>
                  ) : messages.length ? (
                    <div className="hl-cap" style={{ textAlign: 'center' }}>대화의 처음이에요</div>
                  ) : null}
                  {!messages.length ? <EmptyNote>아직 메시지가 없어요 · 첫 메시지를 보내 보세요</EmptyNote> : null}
                  {messages.map((m) => {
                    const day = fmtDate(m.createdAt);
                    const sep = day !== prevDay ? <div className="hl-daysep">{dayLabel(m.createdAt)}</div> : null;
                    prevDay = day;
                    return (
                      <Fragment key={m.id}>
                        {sep}
                        {m.messageType === 'SYSTEM' || m.senderId === null ? (
                          <SystemLine message={m} />
                        ) : (
                          <MessageItem
                            message={m}
                            room={room}
                            myEmployeeId={myId}
                            draft={draftByMessage.get(m.id)}
                            canCreateDraft={canCreateDraft}
                            creatingDraft={createDraft.isPending && createDraft.variables?.messageId === m.id}
                            onCreateDraft={(msg) => createDraft.mutate({ messageId: msg.id, actionType: 'PURCHASE_REQUISITION_CREATE' })}
                          />
                        )}
                      </Fragment>
                    );
                  })}
                </>
              )}
            </QueryBoundary>
          </div>
          {newBelow ? (
            <button type="button" className="hl-btn hl-btn--primary hl-btn--sm msgr-newpill" onClick={toBottom}>
              <Icon name="chevron-down" size="sm" />새 메시지 {newBelow}건
            </button>
          ) : null}
        </div>
        <ChatComposer room={room} myEmployeeId={myId} onSent={onSent} />
      </main>
      {asideOpen ? <RoomAside room={room} files={files} myEmployeeId={myId} onInvite={() => setModal('invite')} onLeave={() => setModal('leave')} /> : null}
      {modal === 'invite' ? <InviteModal room={room} myEmployeeId={myId} onClose={() => setModal(null)} /> : null}
      {modal === 'leave' ? (
        <LeaveModal
          room={room}
          onClose={() => setModal(null)}
          onLeft={() => {
            navigate('/messenger', { replace: true });
            queryClient.removeQueries({ queryKey: chatKeys.room(roomId) });
            queryClient.removeQueries({ queryKey: chatKeys.messages(roomId) });
            queryClient.setQueryData<ChatRoomView[]>(chatKeys.rooms, (old) => old?.filter((r) => r.id !== roomId));
            void queryClient.invalidateQueries({ queryKey: chatKeys.unread });
          }}
        />
      ) : null}
    </>
  );
}

// ───────────────────────────── 화면 ─────────────────────────────
export function MessengerPage() {
  const me = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const roomId = Number(params.get('room')) || null;
  const [newOpen, setNewOpen] = useState(false);

  const rooms = useQuery({ queryKey: chatKeys.rooms, queryFn: messengerApi.rooms });
  const inList = roomId ? rooms.data?.find((r) => r.id === roomId) : undefined;
  // 목록에 없는 방 번호(방금 초대받았거나 멤버가 아닌 방)는 상세로 확인한다
  const detail = useQuery({ queryKey: chatKeys.room(roomId ?? 0), queryFn: () => messengerApi.room(roomId ?? 0), enabled: !!roomId && rooms.data !== undefined && !inList });
  const room = inList ?? (roomId && !detail.error ? detail.data : undefined);

  // 새 메시지(보낸 사람 본인 포함)를 열어 본 방의 대화에 붙인다. 방 목록·배지는 셸(useShellLive)이 같은 캐시에 반영한다.
  // 방 생성·초대·나가기는 서버가 changed{chat-rooms}를 보내 'chat-rooms'로 시작하는 조회가 다시 불린다.
  useRealtimeEvent<MessageView>('message', appendMessageToCache);

  const totalUnread = (rooms.data ?? []).reduce((sum, r) => sum + r.unreadCount, 0);
  useShellTitle(undefined, room ? room.displayName : rooms.data ? `대화방 ${rooms.data.length}개 · 안 읽음 ${totalUnread}` : undefined);

  return (
    <>
      <QueryBoundary query={rooms} loadingLabel="대화방을 불러오는 중…">
        {(list) => <RoomList rooms={list} roomId={roomId} myEmployeeId={me.employeeId} onNew={() => setNewOpen(true)} />}
      </QueryBoundary>
      {rooms.data === undefined ? null : room ? (
        <Conversation key={room.id} room={room} />
      ) : roomId && detail.isLoading ? (
        <main className="hl-main"><StateView kind="loading" title="대화방을 불러오는 중…" /></main>
      ) : roomId ? (
        <main className="hl-main">
          <QueryBoundary query={detail}>{() => null}</QueryBoundary>
        </main>
      ) : (
        <main className="hl-main">
          <StateView
            kind="empty"
            title="대화방을 골라 주세요"
            text="왼쪽 목록에서 방을 고르거나 새 대화를 시작해 보세요"
            actions={<button type="button" className="hl-btn hl-btn--primary" onClick={() => setNewOpen(true)}><Icon name="plus" />새 대화</button>}
          />
        </main>
      )}
      {newOpen ? (
        <NewRoomModal
          myEmployeeId={me.employeeId}
          onClose={() => setNewOpen(false)}
          onCreated={(created) => {
            setNewOpen(false);
            navigate(`/messenger?room=${created.id}`);
          }}
        />
      ) : null}
    </>
  );
}
