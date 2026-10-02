// 조직 화면 공통 표시: 사용 여부 배지, 부서장 꼬리표(역할처럼 보이지 않게 outline)
import { Badge } from '@/components/Badge';
import { Tag } from '@/components/Tag';
import { activeLabelOf } from '@/features/admin/lib/orgRules';

export function ActiveBadge({ isActive }: { isActive: boolean }) {
  return <Badge tone={isActive ? 'ok' : 'neutral'}>{activeLabelOf(isActive)}</Badge>;
}

/** 부서장 표시. 부서장은 역할이 아니라 부서에 지정된 승인권자다 (REQ-AUTH-004). */
export function HeadTag({ departmentNames, size = 'md' }: { departmentNames?: readonly string[]; size?: 'sm' | 'md' }) {
  const title = departmentNames && departmentNames.length > 0 ? `${departmentNames.join('·')} 부서장 · 구매요청 승인권자` : '부서장 · 구매요청 승인권자';
  return (
    <Tag tone="outline" size={size} title={title}>
      부서장
    </Tag>
  );
}
