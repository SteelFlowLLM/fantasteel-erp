// Vitest 공통 준비: api 함수를 가짜 DB(메모리)에 바로 돌린다.
import { beforeEach } from 'vitest';
import { setActingEmployeeForTest } from '@/api/actor';
import { setMockLatencyForTest } from '@/api/client';
import { resetToSeed } from '@/mock/db';
import { clearMockFiles } from '@/mock/fileStorage';

setMockLatencyForTest(0);

beforeEach(() => {
  clearMockFiles();
  resetToSeed();
  setActingEmployeeForTest(undefined);
});
