// Vitest 공통 준비: 테스트마다 요청 사원을 비운다 (서버 어댑터 테스트는 useFakeServer가 정한다).
import { beforeEach } from 'vitest';
import { setActingEmployeeNoForTest } from '@/api/actor';

beforeEach(() => {
  setActingEmployeeNoForTest(undefined);
});
