'use client';

// 업무방 열기 (REQ-MSG-001, BP-MSG-01): 수주 1건에 업무방 1개. 멤버는 조직도에서 고른다. 연 사람은 늘 들어간다.
// 이미 방이 있으면 그 방을 열고, 새로 고른 사람만 더한다.
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { OrgChartNode } from '@/api/directory';
import { salesOrderApi } from '@/api/salesOrders';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Tag } from '@/components/Tag';
import { useAction } from '@/hooks/useAction';
import { useOrgChart } from '@/hooks/useDirectory';
import { useMe } from '@/hooks/useMe';
import { useSalesOrderWorkRoom } from '@/hooks/useSalesOrders';
import { cn } from '@/lib/cn';

interface Props {
  salesOrderId: number;
  salesOrderNo: string;
  onClose: () => void;
}

/** 이름·부서로 거른 조직도 (인원이 없는 부서는 뺀다) */
function filterTree(nodes: readonly OrgChartNode[], keyword: string): OrgChartNode[] {
  if (keyword === '') return [...nodes];
  return nodes.flatMap((node) => {
    const deptHit = node.departmentName.toLowerCase().includes(keyword);
    const members = deptHit ? node.members : node.members.filter((m) => m.employeeName.toLowerCase().includes(keyword));
    const children = filterTree(node.children, keyword);
    return members.length > 0 || children.length > 0 ? [{ ...node, members, children }] : [];
  });
}

export function OpenWorkRoomModal({ salesOrderId, salesOrderNo, onClose }: Props) {
  const router = useRouter();
  const me = useMe();
  const orgChart = useOrgChart();
  const room = useSalesOrderWorkRoom(salesOrderId);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [keyword, setKeyword] = useState('');
  const existing = useMemo(() => new Set(room.data?.memberEmployeeIds ?? []), [room.data]);

  const open = useAction(salesOrderApi.openWorkRoom, {
    success: (result) => (result.created ? `${result.chatRoomName ?? salesOrderNo} 업무방을 열었어요` : '업무방을 열었어요'),
    onSuccess: (result) => {
      onClose();
      router.push(`/messenger?room=${result.chatRoomId}`);
    },
  });

  const toggle = (employeeId: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });

  // 들여쓰기는 트리 깊이에 따라 정해지는 값이라 style로 준다
  const renderNode = (node: OrgChartNode, depth: number) => (
    <li key={node.id} className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-ink-2" style={{ paddingLeft: depth * 14 }}>
        {node.departmentName}
      </span>
      {node.members.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" style={{ paddingLeft: depth * 14 }}>
          {node.members.map((member) => {
            const isMe = member.id === me.employeeId;
            const already = existing.has(member.id);
            const checked = isMe || already || picked.has(member.id);
            const locked = isMe || already;
            return (
              <li key={member.id}>
                <label
                  className={cn(
                    'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-sm border px-2 text-xs',
                    checked ? 'border-brand bg-brand-tint text-brand' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-2',
                    locked && 'cursor-default opacity-80',
                  )}
                >
                  <input type="checkbox" className="size-3.5" checked={checked} disabled={locked} onChange={() => toggle(member.id)} />
                  <span className="font-medium">{member.employeeName}</span>
                  <span className="text-ink-3">{member.jobGradeName}</span>
                  {member.isHead ? (
                    <Tag tone="outline" size="sm">
                      부서장
                    </Tag>
                  ) : null}
                  {isMe ? (
                    <Tag tone="brand" size="sm">
                      나
                    </Tag>
                  ) : already ? (
                    <Tag size="sm">멤버</Tag>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
      {node.children.length > 0 ? <ul className="flex flex-col gap-2">{node.children.map((child) => renderNode(child, depth + 1))}</ul> : null}
    </li>
  );

  const hasRoom = Boolean(room.data);
  return (
    <Modal
      title={`업무방 열기 · ${salesOrderNo}`}
      onClose={onClose}
      width={640}
      footer={
        <>
          <span className="mr-auto self-center text-cap text-ink-3">
            {hasRoom ? `지금 멤버 ${existing.size}명` : '나'} + 새로 고른 사람 {picked.size}명
          </span>
          <Button onClick={onClose} disabled={open.isPending}>
            닫기
          </Button>
          <Button
            variant="primary"
            icon="hash"
            disabled={open.isPending || room.isPending}
            onClick={() => open.mutate({ salesOrderId, memberEmployeeIds: [...picked] })}
          >
            {open.isPending ? '여는 중…' : hasRoom ? '업무방으로 가기' : '업무방 만들기'}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-5 text-ink-2">
        {hasRoom
          ? '이 수주의 업무방이 이미 있어요. 더할 사람을 고르면 함께 들어가요.'
          : '이 수주와 연결된 업무방을 만들어요. 함께할 사람을 조직도에서 골라 주세요. 연 사람은 늘 들어가요.'}
      </p>
      <Input leadingIcon="search" aria-label="이름·부서 검색" placeholder="이름·부서 검색" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
      <QueryBoundary query={orgChart} loadingLabel="조직도를 불러오는 중…">
        {(tree) => {
          const filtered = filterTree(tree, keyword.trim().toLowerCase());
          return filtered.length === 0 ? (
            <EmptyNote>조건에 맞는 사람이 없어요</EmptyNote>
          ) : (
            <ul className="flex max-h-[360px] flex-col gap-2.5 overflow-auto">{filtered.map((node) => renderNode(node, 0))}</ul>
          );
        }}
      </QueryBoundary>
    </Modal>
  );
}
