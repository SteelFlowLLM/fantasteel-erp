'use client';

// 사원 상세: 사원 정보 · 역할 권한 · 부서장 지정. 사용 여부는 '사용 안 함'·'다시 사용' 동작으로 바꾼다 (컨벤션 7-2 퇴사 처리).
import Link from 'next/link';
import { useState } from 'react';
import { PERMISSION, ROLE_LABEL } from '@/codes';
import { employeeAdminApi } from '@/api/adminEmployees';
import type { DepartmentView, EmployeeView, RoleView } from '@/api/directory';
import { Avatar } from '@/components/Avatar';
import { Banner } from '@/components/Banner';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { KvList } from '@/components/KvList';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { Tag } from '@/components/Tag';
import { ActiveBadge, HeadTag } from '@/features/admin/components/OrgBadges';
import { RolePermissionSummary } from '@/features/admin/components/RolePermissionSummary';
import { activeLabelOf } from '@/features/admin/lib/orgRules';
import { useAction } from '@/hooks/useAction';
import { useCanView } from '@/hooks/usePermission';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';

export interface EmployeeDetailProps {
  employee: EmployeeView;
  meId: number;
  canManage: boolean;
  roles: readonly RoleView[];
  departments: readonly DepartmentView[];
  summary: string;
  onEdit: () => void;
}

export function EmployeeDetail({ employee, meId, canManage, roles, departments, summary, onEdit }: EmployeeDetailProps) {
  const canViewOrg = useCanView(PERMISSION.ORG_MANAGE);
  const [confirm, setConfirm] = useState(false);
  const role = roles.find((r) => r.id === employee.roleId);
  const headOf = departments.filter((d) => employee.headDepartmentIds.includes(d.id));
  const isMe = employee.id === meId;
  const isHead = headOf.length > 0;

  const deactivate = useAction(employeeAdminApi.deactivate, { success: (saved) => `${saved.employeeName} 사원을 사용 안 함으로 바꿨어요`, onSuccess: () => setConfirm(false) });
  const activate = useAction(employeeAdminApi.activate, { success: (saved) => `${saved.employeeName} 사원을 다시 사용하도록 바꿨어요` });

  const lockTitle = canManage ? undefined : permissionNeedText([PERMISSION.EMPLOYEE_MANAGE]);
  const deactivateTitle = lockTitle ?? (isHead ? `${headOf.map((d) => d.departmentName).join('·')} 부서장이라 사용 안 함으로 바꿀 수 없어요 · 부서장을 먼저 바꿔 주세요` : undefined);
  const reactivate = () => activate.mutate({ id: employee.id, expectedUpdatedAt: employee.updatedAt });

  return (
    <>
      <div className="flex flex-none items-center gap-3">
        <Avatar name={employee.employeeName} size="lg" tone={employee.isActive ? 'brand' : 'neutral'} />
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{employee.employeeName}</h1>
            <Tag tone="brand">{ROLE_LABEL[employee.roleCode]}</Tag>
            <ActiveBadge isActive={employee.isActive} />
            {isHead ? <HeadTag departmentNames={headOf.map((d) => d.departmentName)} /> : null}
            {isMe ? <Tag>나</Tag> : null}
          </div>
          <span className="text-cap text-ink-3">
            {employee.departmentName} · {employee.jobGradeName} · 사원번호 {employee.employeeNo}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <span className="text-cap text-ink-3">{summary}</span>
          {canViewOrg ? (
            <ButtonLink href="/admin/organization" icon="key">
              부서·직급·권한
            </ButtonLink>
          ) : null}
          {canManage ? null : <ReadOnlyHint permissions={[PERMISSION.EMPLOYEE_MANAGE]} />}
          <Button icon="edit" disabled={!canManage} title={lockTitle} onClick={onEdit}>
            정보 수정
          </Button>
          {employee.isActive ? (
            <Button variant="danger-outline" disabled={!canManage || isHead} title={deactivateTitle} onClick={() => setConfirm(true)}>
              사용 안 함
            </Button>
          ) : null}
        </div>
      </div>

      {employee.isActive ? null : (
        <Banner
          className="flex-none"
          actions={
            <Button size="sm" variant="primary" disabled={!canManage || activate.isPending} title={lockTitle} onClick={reactivate}>
              다시 사용
            </Button>
          }
        >
          <b>사용 안 함 상태의 사원이에요</b>
          <br />
          계정 선택·조직도·담당자 목록에서 빠지고 업무를 할 수 없어요.
        </Banner>
      )}

      <div className="grid flex-none grid-cols-2 gap-4">
        <Card>
          <CardHead title="사원 정보" />
          <CardBody>
            <KvList
              items={[
                { label: '사원번호', value: <span className="font-mono">{employee.employeeNo}</span> },
                { label: '이름', value: employee.employeeName },
                { label: '부서', value: employee.departmentName },
                { label: '직급', value: employee.jobGradeName },
                { label: '역할', value: ROLE_LABEL[employee.roleCode] },
                { label: '사용 여부', value: activeLabelOf(employee.isActive) },
                { label: '최근 접속', value: employee.lastLoginAt ? fmtDateTime(employee.lastLoginAt) : '접속 기록 없음' },
                { label: '등록일', value: fmtDate(employee.createdAt) },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHead title="역할 권한" meta={`${ROLE_LABEL[employee.roleCode]} 역할`} />
          <CardBody className="gap-2">
            {role ? <RolePermissionSummary permissions={role.permissions} /> : <span className="text-cap text-ink-3">역할 정보를 불러오는 중…</span>}
            {canViewOrg ? (
              <Link href={`/admin/organization?tab=permissions&role=${employee.roleCode}`} className="self-start text-cap text-run hover:underline">
                행렬에서 보기
              </Link>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <Card className="flex-none">
        <CardHead
          title={
            <span className="inline-flex items-center gap-1.5">
              <Icon name="approve" />
              부서장 지정
            </span>
          }
        />
        <CardBody className="gap-1.5">
          {isHead ? (
            <div className="flex flex-wrap gap-1.5">
              {headOf.map((d) => (
                <Tag key={d.id} tone="outline">
                  {d.departmentName} 부서장
                </Tag>
              ))}
            </div>
          ) : (
            <span className="text-cap text-ink-3">부서장으로 지정된 부서가 없어요</span>
          )}
          <span className="text-cap text-ink-3">부서장은 그 부서 사원이 올린 구매요청의 승인권자예요. 부서장은 역할이 아니고, 부서·직급·권한 화면의 부서 탭에서 지정해요.</span>
        </CardBody>
      </Card>

      {confirm ? (
        <ConfirmDialog
          title="사용 안 함으로 바꿀까요?"
          confirmLabel="사용 안 함"
          tone="danger"
          pending={deactivate.isPending}
          onCancel={() => setConfirm(false)}
          onConfirm={() => deactivate.mutate({ id: employee.id, expectedUpdatedAt: employee.updatedAt })}
        >
          <p>
            {employee.employeeName}({employee.employeeNo}) 사원은 계정 선택·조직도·담당자 목록에서 빠지고 업무를 할 수 없어요. 나중에 다시 사용으로 돌릴 수 있어요.
          </p>
          {isMe ? <p className="mt-2 font-semibold text-danger">내 계정이에요. 바꾸면 바로 이 화면에서 더 일할 수 없어요.</p> : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
