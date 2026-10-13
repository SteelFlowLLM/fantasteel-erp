// 테스트용: 서버 시드 사원번호(docs/backend/seed.md)로 '이 사원이 요청했다'를 흉내 낸다.
import { setActingEmployeeNoForTest } from '@/api/actor';

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

/** 이 사원으로 요청한다 */
export function actAs(employeeNo: string): void {
  setActingEmployeeNoForTest(employeeNo);
}
