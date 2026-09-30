import type { Tx } from '../../prisma/prisma.service';
import { ApproverResolver } from './approver.resolver';
import { DepartmentRepository } from './department.repository';
import { EmployeeRepository } from './employee.repository';

// @nestjs/common 12는 ESM 전용이라 플래그 없는 jest에서는 대체품을 쓴다 (testing/nest-common.shim.ts 참고)
jest.mock('@nestjs/common', () => require('./testing/nest-common.shim'));

interface Dept { id: number; parentId: number | null; headEmployeeId: number | null }
interface Emp { id: number; departmentId: number; status: string }

/** tx 대신 메모리 데이터로 답하는 가짜. 리졸버가 부르는 조회 2종만 흉내 낸다. */
function fakeTx(depts: Dept[], emps: Emp[]): Tx {
  const empById = new Map(emps.map((e) => [e.id, e]));
  return {
    employee: {
      findUnique: async ({ where: { id } }: { where: { id: number } }) => {
        const e = empById.get(id);
        return e ? { id: e.id, employeeStatus: e.status, employeeName: `E${e.id}`, departmentId: e.departmentId } : null;
      },
    },
    department: {
      findUnique: async ({ where: { id } }: { where: { id: number } }) => {
        const d = depts.find((x) => x.id === id);
        if (!d) return null;
        const head = d.headEmployeeId === null ? undefined : empById.get(d.headEmployeeId);
        return { ...d, headEmployee: head ? { employeeStatus: head.status } : null };
      },
    },
  } as unknown as Tx;
}

const resolver = new ApproverResolver(new DepartmentRepository(), new EmployeeRepository());

// HQ(1, 장=100) ─ 생산부(2, 장=200) ─ 제강파트(3, 장=300)
//                └ 영업부(4, 장 없음)
const baseDepts: Dept[] = [
  { id: 1, parentId: null, headEmployeeId: 100 },
  { id: 2, parentId: 1, headEmployeeId: 200 },
  { id: 3, parentId: 2, headEmployeeId: 300 },
  { id: 4, parentId: 1, headEmployeeId: null },
];
const baseEmps: Emp[] = [
  { id: 100, departmentId: 1, status: 'ACTIVE' },
  { id: 200, departmentId: 2, status: 'ACTIVE' },
  { id: 300, departmentId: 3, status: 'ACTIVE' },
  { id: 301, departmentId: 3, status: 'ACTIVE' }, // 제강파트 일반 사원
  { id: 400, departmentId: 4, status: 'ACTIVE' }, // 부서장 없는 부서 사원
];

describe('ApproverResolver.resolveApprover', () => {
  const tx = fakeTx(baseDepts, baseEmps);

  it('일반 사원 → 자기 부서의 부서장', async () => {
    expect(await resolver.resolveApprover(tx, 301)).toEqual({ approverId: 300, departmentId: 3 });
  });

  it('부서장 본인 → 상위 부서의 부서장 (부서 id는 요청자 소속 부서)', async () => {
    expect(await resolver.resolveApprover(tx, 300)).toEqual({ approverId: 200, departmentId: 3 });
  });

  it('최상위 부서의 부서장 본인 → 올라갈 곳이 없어 null (자기 승인 금지)', async () => {
    expect(await resolver.resolveApprover(tx, 100)).toBeNull();
  });

  it('요청자가 부서와 상위 부서의 부서장을 겸하면 한 단계 더 올라간다', async () => {
    const depts = baseDepts.map((d) => (d.id === 2 ? { ...d, headEmployeeId: 300 } : d));
    expect(await resolver.resolveApprover(fakeTx(depts, baseEmps), 300)).toEqual({ approverId: 100, departmentId: 3 });
  });

  it('부서장이 비어 있는 부서의 사원 → null', async () => {
    expect(await resolver.resolveApprover(tx, 400)).toBeNull();
  });

  it('부서장 본인인데 상위 부서에 부서장이 없으면 null', async () => {
    const depts = baseDepts.map((d) => (d.id === 2 ? { ...d, headEmployeeId: null } : d));
    expect(await resolver.resolveApprover(fakeTx(depts, baseEmps), 300)).toBeNull();
  });

  it('부서장이 사용 중지(INACTIVE)면 null', async () => {
    const emps = baseEmps.map((e) => (e.id === 300 ? { ...e, status: 'INACTIVE' } : e));
    expect(await resolver.resolveApprover(fakeTx(baseDepts, emps), 301)).toBeNull();
  });

  it('부서장이 잠김(LOCKED)이면 승인권자로 인정한다 (계정을 풀면 승인 가능)', async () => {
    const emps = baseEmps.map((e) => (e.id === 300 ? { ...e, status: 'LOCKED' } : e));
    expect(await resolver.resolveApprover(fakeTx(baseDepts, emps), 301)).toEqual({ approverId: 300, departmentId: 3 });
  });

  it('없는 사원 → null', async () => {
    expect(await resolver.resolveApprover(tx, 999)).toBeNull();
  });

  it('상위 부서 사슬에 순환이 있어도 끝나고 null을 돌려준다', async () => {
    const depts: Dept[] = [
      { id: 1, parentId: 2, headEmployeeId: 300 },
      { id: 2, parentId: 1, headEmployeeId: 300 },
    ];
    const emps: Emp[] = [{ id: 300, departmentId: 1, status: 'ACTIVE' }];
    expect(await resolver.resolveApprover(fakeTx(depts, emps), 300)).toBeNull();
  });
});
