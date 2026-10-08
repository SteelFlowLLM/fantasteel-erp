// 방 정보 칸: 대화 검색, 업무방이면 수주 요약·아니면 방 정보, 멤버, 파일 모아보기
import type { ReactNode } from 'react';
import { CHAT_ROOM_TYPE_LABEL } from '@/codes';
import type { ChatRoomDetailView } from '@/api/messenger';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { ComingSoon } from '@/components/ComingSoon';
import { Tag } from '@/components/Tag';
import { WorkRoomSummary } from '@/features/messenger/components/WorkRoomSalesOrder';
import { RoomFiles, RoomSearch } from '@/features/messenger/components/RoomAsideTools';
import { fmtDate } from '@/lib/format';

function Section({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-b border-line px-4 py-3.5">
      <div className="flex items-center gap-2">
        <b className="text-sm font-semibold">{title}</b>
        {actions ? <span className="ml-auto">{actions}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function RoomAside({ room, onInvite, onRename }: { room: ChatRoomDetailView; onInvite: () => void; onRename: () => void }) {
  return (
    <aside className="hidden min-h-0 w-[300px] flex-none flex-col overflow-auto border-l border-line bg-surface xl:flex" aria-label="방 정보">
      <Section title="대화 검색">
        <RoomSearch chatRoomId={room.id} />
      </Section>
      {room.chatRoomType === 'WORK' ? (
        <Section title="수주 요약">
          <WorkRoomSummary room={room} />
        </Section>
      ) : (
        <Section
          title="방 정보"
          actions={
            <span className="flex items-center gap-1.5">
              {room.chatRoomType === 'GROUP' ? (
                <Button size="sm" variant="ghost" onClick={onRename}>
                  이름 바꾸기
                </Button>
              ) : null}
              <Tag size="sm" tone="neutral">
                {CHAT_ROOM_TYPE_LABEL[room.chatRoomType]}
              </Tag>
            </span>
          }
        >
          <dl className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1.5 text-xs">
            <dt className="text-ink-3">이름</dt>
            <dd>{room.displayName}</dd>
            <dt className="text-ink-3">개설일</dt>
            <dd>{fmtDate(room.createdAt)}</dd>
            <dt className="text-ink-3">만든 사람</dt>
            <dd>{room.createdEmployeeName}</dd>
          </dl>
        </Section>
      )}
      <Section
        title={`멤버 ${room.members.length}`}
        actions={
          room.canInvite ? (
            <Button size="sm" variant="ghost" icon="plus" onClick={onInvite}>
              초대
            </Button>
          ) : null
        }
      >
        <ul className="flex flex-col gap-2">
          {room.members.map((member) => (
            <li key={member.id} className="flex items-center gap-2 text-sm">
              <Avatar name={member.employeeName} size="sm" tone={member.isMe ? 'brand' : 'neutral'} />
              <span className="min-w-0 truncate">
                {member.employeeName} <span className="text-xs text-ink-3">{member.jobGradeName}</span>
                {member.isMe ? <span className="text-xs text-ink-3"> · 나</span> : null}
              </span>
              <span className="ml-auto flex flex-none items-center gap-1">
                {member.isHead ? (
                  <Tag size="sm" tone="outline">
                    부서장
                  </Tag>
                ) : null}
                <Tag size="sm">{member.departmentName}</Tag>
              </span>
            </li>
          ))}
          <li className="flex items-center gap-2 text-sm text-ink-3">
            <span className="flex size-[22px] items-center justify-center rounded-full bg-ai-bg text-[10px] font-semibold text-ai-strong">AI</span>
            AI 어시스턴트 (@AI 호출)
            <ComingSoon grade="P2" className="ml-auto" />
          </li>
        </ul>
        {room.chatRoomType === 'DIRECT' ? <p className="text-cap text-ink-3">1:1 채팅방에는 멤버를 추가할 수 없어요. 그룹 채팅방을 새로 만들어 주세요</p> : null}
      </Section>
      <Section title="파일">
        <RoomFiles chatRoomId={room.id} />
      </Section>
    </aside>
  );
}
