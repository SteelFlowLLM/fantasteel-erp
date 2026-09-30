/**
 * 테스트 전용 @nestjs/common 대체품.
 * @nestjs/common 12는 ESM 전용이라 플래그 없는 `npx jest`로는 불러오지 못한다 ("Must use import to load ES Module").
 * 수주·재고·출하 테스트는 service를 직접 조립해 실제 DB로 돌리므로 프레임워크 동작(DI·라우팅)은 필요 없고,
 * 데코레이터와 HttpException·Logger 모양만 있으면 된다.
 * 사용: 스펙 맨 위에 `jest.mock('@nestjs/common', () => require('<상대경로>/nest-common.shim'));`
 */
const noopDecorator = () => () => undefined;

export const Injectable = noopDecorator;
export const Global = noopDecorator;
export const Module = noopDecorator;

export const HttpStatus = { OK: 200, BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INTERNAL_SERVER_ERROR: 500 } as const;

export class HttpException extends Error {
  constructor(
    private readonly response: unknown,
    private readonly status: number,
  ) {
    super(typeof response === 'string' ? response : ((response as { message?: string }).message ?? 'HttpException'));
  }
  getStatus() {
    return this.status;
  }
  getResponse() {
    return this.response;
  }
}

export class Logger {
  log() {}
  warn() {}
  error() {}
}

export class StreamableFile {}
