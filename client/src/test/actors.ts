// 테스트용: 시드 사원번호로 '이 사원이 요청했다'를 흉내 낸다 (seed-assumptions.md 1-4).
import { setActingEmployeeForTest } from '@/api/actor';
import { getMockDb } from '@/mock/db';

export const SEED_EMPLOYEE_NO = {
  /** 이현정 · 경영지원부 부서장 · 관리자 */
  admin: '1503001',
  /** 김도윤 · 영업부 부서장 · 영업 */
  salesHead: '1608002',
  /** 박서영 · 영업부 · 영업 */
  sales: '2103003',
  /** 최준혁 · 구매부 부서장 · 구매 */
  purchaseHead: '1702004',
  /** 정다은 · 구매부 · 구매 */
  purchase: '2207005',
  /** 강민석 · 생산부 부서장 · 생산 */
  productionHead: '1401006',
  /** 장혜린 · 제강파트 부서장 · 생산 */
  steelmakingHead: '1804008',
  /** 조은서 · 제강파트 · 생산 */
  steelmaking: '2402011',
  /** 오지훈 · 품질부 부서장 · 품질 */
  qualityHead: '1802012',
  /** 서민지 · 품질부 · 품질 */
  quality: '2205013',
  /** 신현우 · 물류부 부서장 · 물류 */
  logisticsHead: '1610014',
  /** 권예진 · 물류부 · 물류 */
  logistics: '2304015',
} as const;

export function employeeIdOf(employeeNo: string): number {
  const employee = getMockDb().read((tables) => tables.employee.find((e) => e.employeeNo === employeeNo));
  if (!employee) throw new Error(`시드 사원이 없어요: ${employeeNo}`);
  return employee.id;
}

/** 이 사원으로 요청한다. id를 돌려준다. */
export function actAs(employeeNo: string): number {
  const id = employeeIdOf(employeeNo);
  setActingEmployeeForTest(id);
  return id;
}

export function departmentIdOf(departmentCode: string): number {
  const department = getMockDb().read((tables) => tables.department.find((d) => d.departmentCode === departmentCode));
  if (!department) throw new Error(`시드 부서가 없어요: ${departmentCode}`);
  return department.id;
}
