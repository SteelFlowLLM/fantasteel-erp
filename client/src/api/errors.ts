// 업무 오류 클래스. 화면(api/)과 가짜 서버 서비스(mock/services/)가 함께 쓴다.
// api/client.ts는 가짜 DB를 불러오므로, 서비스는 순환 참조를 피하려고 이 파일에서 직접 가져온다.
import { ERROR_MESSAGE, type ErrorCode } from '@/codes';

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
