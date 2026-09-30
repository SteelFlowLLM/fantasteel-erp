/**
 * 단위 테스트 전용 @nestjs/common 대체품.
 * @nestjs/common 12는 ESM 전용이라 플래그 없는 `npx jest`로는 불러올 수 없다 ("Must use import to load ES Module").
 * 테스트는 서비스를 직접 생성해(new) 쓰므로 DI·데코레이터 동작은 필요 없다. 예외 클래스와 Logger만 실제처럼 동작하면 된다.
 * 사용: 스펙 맨 위에 `jest.mock('@nestjs/common', () => require('<상대경로>/nest-common.shim'));`
 */
type AnyDecorator = (...args: unknown[]) => unknown;
const noopDecorator = () => () => undefined;

export const Injectable = noopDecorator;
export const Inject = noopDecorator;
export const Global = noopDecorator;
export const Module = noopDecorator;
export const Controller = noopDecorator;
export const Get = noopDecorator;
export const Post = noopDecorator;
export const Patch = noopDecorator;
export const HttpCode = noopDecorator;
export const Body = noopDecorator;
export const Param = noopDecorator;
export const Query = noopDecorator;
export const SetMetadata = noopDecorator;
export const createParamDecorator = () => noopDecorator;
export class ParseIntPipe {}

export const applyDecorators = (...decorators: AnyDecorator[]) => (...args: unknown[]) => {
  for (const decorator of decorators) decorator(...args);
};

export class Logger {
  log(): void {}
  warn(): void {}
  error(): void {}
}

export const HttpStatus = { OK: 200, BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INTERNAL_SERVER_ERROR: 500 } as const;

export class HttpException extends Error {
  constructor(private readonly response: unknown, private readonly status: number) {
    super(typeof response === 'string' ? response : ((response as { message?: string }).message ?? 'HttpException'));
  }
  getStatus() {
    return this.status;
  }
  getResponse() {
    return this.response;
  }
}
