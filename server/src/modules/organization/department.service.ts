import { Injectable } from '@nestjs/common';
import { BUSINESS_EVENT_TYPE, EMPLOYEE_STATUS, EVENT_TARGET_TYPE, type AuthUser } from '@fantasteel/shared';
import { badInput, notFound } from '../../common/errors/app.exception';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { wouldCreateCycle } from './department-hierarchy';
import { DepartmentRepository, type DepartmentRow } from './department.repository';
import type { CreateDepartmentDto } from './dto/create-department.dto';
import type { UpdateDepartmentDto } from './dto/update-department.dto';
import { EmployeeRepository } from './employee.repository';

export interface DepartmentView {
  id: number;
  departmentCode: string;
  departmentName: string;
  parentId: number | null;
  headEmployeeId: number | null;
  headEmployeeName: string | null;
  sortOrder: number;
  /** ACTIVE 사원 수 */
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgChartMember {
  id: number;
  employeeName: string;
  jobGrade: string;
  roleCode: string;
  isHead: boolean;
}

export interface OrgChartNode {
  id: number;
  departmentCode: string;
  departmentName: string;
  sortOrder: number;
  head: { id: number; employeeName: string; jobGrade: string } | null;
  members: OrgChartMember[];
  children: OrgChartNode[];
}

function toView(d: DepartmentRow): DepartmentView {
  return {
    id: d.id,
    departmentCode: d.departmentCode,
    departmentName: d.departmentName,
    parentId: d.parentId,
    headEmployeeId: d.headEmployeeId,
    headEmployeeName: d.headEmployee?.employeeName ?? null,
    sortOrder: d.sortOrder,
    memberCount: d._count.employees,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

@Injectable()
export class DepartmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly departments: DepartmentRepository,
    private readonly employees: EmployeeRepository,
    private readonly events: BusinessEventRecorder,
    private readonly realtime: RealtimeService,
  ) {}

  async list(): Promise<DepartmentView[]> {
    return (await this.departments.list(this.prisma)).map(toView);
  }

  /** 조직도: 부서 트리 + 부서별 ACTIVE 인원 (REQ-ORG-003). 부서장이 맨 앞, 나머지는 사원번호순. */
  async tree(): Promise<OrgChartNode[]> {
    const [rows, members] = await Promise.all([this.departments.list(this.prisma), this.departments.activeMembers(this.prisma)]);
    const byId = new Map<number, OrgChartNode>();
    for (const d of rows) {
      byId.set(d.id, {
        id: d.id,
        departmentCode: d.departmentCode,
        departmentName: d.departmentName,
        sortOrder: d.sortOrder,
        head: d.headEmployeeId && d.headEmployee ? { id: d.headEmployeeId, employeeName: d.headEmployee.employeeName, jobGrade: d.headEmployee.jobGrade } : null,
        members: [],
        children: [],
      });
    }
    const headOf = new Map(rows.map((d) => [d.id, d.headEmployeeId]));
    for (const m of members) {
      byId.get(m.departmentId)?.members.push({
        id: m.id,
        employeeName: m.employeeName,
        jobGrade: m.jobGrade,
        roleCode: m.role.roleCode,
        isHead: headOf.get(m.departmentId) === m.id,
      });
    }
    const roots: OrgChartNode[] = [];
    // rows는 sortOrder·id순이라 자식도 그 순서로 붙는다. 상위 부서가 없거나 못 찾으면 최상위로 둔다.
    for (const d of rows) {
      const node = byId.get(d.id)!;
      const parent = d.parentId !== null ? byId.get(d.parentId) : undefined;
      (parent ? parent.children : roots).push(node);
    }
    for (const node of byId.values()) node.members.sort((a, b) => Number(b.isHead) - Number(a.isHead));
    return roots;
  }

  async create(dto: CreateDepartmentDto, user: AuthUser): Promise<DepartmentView> {
    return this.prisma.tx(async (tx) => {
      if (await this.departments.findByCode(tx, dto.departmentCode)) throw badInput('이미 사용 중인 부서 코드입니다');
      const parentId = dto.parentId ?? null;
      if (parentId !== null && !(await this.departments.findById(tx, parentId))) throw badInput('존재하지 않는 상위 부서입니다');
      const headEmployeeId = dto.headEmployeeId ?? null;
      if (headEmployeeId !== null) await this.assertActiveHead(tx, headEmployeeId);

      const row = await this.departments.create(tx, {
        departmentCode: dto.departmentCode,
        departmentName: dto.departmentName.trim(),
        parentId,
        headEmployeeId,
        sortOrder: dto.sortOrder ?? 0,
      });
      if (headEmployeeId !== null) await this.recordHeadChanged(tx, user, row, null);
      this.realtime.changed('departments');
      return toView(row);
    });
  }

  async update(id: number, dto: UpdateDepartmentDto, user: AuthUser): Promise<DepartmentView> {
    return this.prisma.tx(async (tx) => {
      const current = await this.departments.findById(tx, id);
      if (!current) throw notFound('부서');

      const parentChanging = dto.parentId !== undefined && dto.parentId !== current.parentId;
      if (parentChanging && dto.parentId !== null) {
        if (!(await this.departments.findById(tx, dto.parentId!))) throw badInput('존재하지 않는 상위 부서입니다');
        const cyclic = wouldCreateCycle(id, dto.parentId!, await this.departments.parentMap(tx));
        if (cyclic) throw badInput('자기 자신이나 하위 부서를 상위 부서로 지정할 수 없습니다');
      }
      const headChanging = dto.headEmployeeId !== undefined && dto.headEmployeeId !== current.headEmployeeId;
      if (headChanging && dto.headEmployeeId !== null) await this.assertActiveHead(tx, dto.headEmployeeId!);

      const row = await this.departments.update(tx, id, {
        departmentName: dto.departmentName?.trim(),
        parentId: dto.parentId,
        headEmployeeId: dto.headEmployeeId,
        sortOrder: dto.sortOrder,
      });
      if (headChanging) await this.recordHeadChanged(tx, user, row, current);
      this.realtime.changed('departments', 'employees');
      return toView(row);
    });
  }

  /** 부서장은 사용 중(ACTIVE)인 사원이어야 한다 (REQ-ORG-002). */
  private async assertActiveHead(tx: Tx, employeeId: number): Promise<void> {
    const e = await this.employees.findStatus(tx, employeeId);
    if (!e) throw badInput('존재하지 않는 사원입니다');
    if (e.employeeStatus !== EMPLOYEE_STATUS.ACTIVE) throw badInput('사용 중인 사원만 부서장으로 지정할 수 있습니다');
  }

  private async recordHeadChanged(tx: Tx, user: AuthUser, after: DepartmentRow, before: DepartmentRow | null): Promise<void> {
    const name = (d: DepartmentRow | null) => d?.headEmployee?.employeeName ?? '없음';
    await this.events.record(tx, {
      actor: user,
      eventType: BUSINESS_EVENT_TYPE.MASTER_CHANGED,
      targetType: EVENT_TARGET_TYPE.MASTER,
      targetId: after.id,
      targetNo: after.departmentCode,
      summary: `${after.departmentName} 부서장 변경: ${name(before)} → ${name(after)}`,
      before: { departmentId: after.id, headEmployeeId: before?.headEmployeeId ?? null, headEmployeeName: before?.headEmployee?.employeeName ?? null },
      after: { departmentId: after.id, headEmployeeId: after.headEmployeeId, headEmployeeName: after.headEmployee?.employeeName ?? null },
    });
  }
}
