// API 호출의 공통 부분. 지금은 브라우저 안 가짜 DB를 읽고 쓴다 (SPEC 1장).
// 화면은 이 폴더의 함수 + 커스텀 훅으로만 데이터에 접근한다 (컨벤션 9장). 나중에 실제 API로 바꿀 때 이 폴더만 고친다.
import { ERROR_MESSAGE, type ErrorCode } from '@/codes';
import { getMockDb } from '@/mock/db';
import type { MockTables } from '@/mock/schema';
import type { MockTx } from '@/mock/store';

/**
 * 업무 오류. 실제 API의 실패 응답 { success: false, error: { code, message } }과 같은 모양 (컨벤션 5장).
 * message는 늘 업무 프로세스 9.3 문구 그대로이고, 어떤 대상인지 같은 덧붙임은 detail에 둔다.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | null;

  constructor(code: ErrorCode, detail: string | null = null) {
    super(ERROR_MESSAGE[code]);
    this.name = 'ApiError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * 입력 확인 오류: 필수값 누락·형식·길이·중복·참조 중 삭제처럼 업무 프로세스 9.3에 코드가 없는 거부.
 * 실제 서버에서는 요청 검증(ValidationPipe, 컨벤션 5장)과 서비스의 규칙 검사가 돌려주는 400·409 응답에 해당한다.
 * fieldErrors는 입력칸 이름 → 안내 문구다. 화면은 해당 칸 아래에 보인다.
 */
export class InputError extends Error {
  readonly fieldErrors: Readonly<Record<string, string>>;

  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = 'InputError';
    this.fieldErrors = fieldErrors;
  }
}

/** 입력칸 오류를 모아 두었다가 하나라도 있으면 InputError로 던진다 */
export class FieldErrors {
  private readonly errors: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.errors)) this.errors[field] = message;
  }

  get isEmpty(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  throwIfAny(summary = '입력한 내용을 확인해 주세요'): void {
    if (!this.isEmpty) throw new InputError(summary, { ...this.errors });
  }
}

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
