// API 호출의 공통 부분. 지금은 브라우저 안 가짜 DB를 읽고 쓴다 (SPEC 1장).
// 화면은 이 폴더의 함수 + 커스텀 훅으로만 데이터에 접근한다 (컨벤션 9장). 나중에 실제 API로 바꿀 때 이 폴더만 고친다.
import { getMockDb } from '@/mock/db';
import type { MockTables } from '@/mock/schema';
import type { MockTx } from '@/mock/store';

export { ApiError, FieldErrors, InputError } from '@/api/errors';

/** 가짜 서버의 응답 지연(ms). 로딩 상태가 실제처럼 보이게 둔다. */
export const MOCK_LATENCY_MS = 120;
let latencyMs = MOCK_LATENCY_MS;

/** 테스트에서 응답 지연을 없앨 때만 쓴다 */
export function setMockLatencyForTest(ms: number): void {
  latencyMs = ms;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 조회: 결과는 복사본이라 화면에서 고쳐도 DB가 바뀌지 않는다 */
export async function mockQuery<T>(reader: (tables: Readonly<MockTables>) => T): Promise<T> {
  await wait(latencyMs);
  return structuredClone(getMockDb().read(reader));
}

/** 변경: 한 트랜잭션으로 저장하고 다른 탭에 알린다. 함수 안에서 오류가 나면 아무것도 저장되지 않는다. */
export async function mockMutation<T>(work: (tx: MockTx) => T): Promise<T> {
  await wait(latencyMs);
  return structuredClone(getMockDb().transact(work));
}
