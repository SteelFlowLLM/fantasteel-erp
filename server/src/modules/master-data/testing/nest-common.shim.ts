/**
 * 단위 테스트 전용 @nestjs/common 대체품.
 * 사유: @nestjs/common 12는 ESM 전용이라, `npx jest`(플래그 없음)로는 이 패키지를 불러오지 못한다
 * ("Must use import to load ES Module"). `NODE_OPTIONS=--experimental-vm-modules`가 있으면 진짜 패키지로도 돈다.
 * 테스트 대상은 순수 규칙과 데코레이터 메타데이터뿐이라 프레임워크 동작은 필요하지 않다.
 * 사용: 스펙 맨 위에 `jest.mock('@nestjs/common', () => require('<상대경로>/nest-common.shim'));`
 */
import 'reflect-metadata';

const noopDecorator = () => () => undefined;

export const Injectable = noopDecorator;
export const Global = noopDecorator;
export const Module = noopDecorator;
export const Controller = noopDecorator;
export const Get = noopDecorator;
export const Post = noopDecorator;
export const Put = noopDecorator;
export const Patch = noopDecorator;
export const Delete = noopDecorator;
export const HttpCode = noopDecorator;
export const Body = noopDecorator;
export const Param = noopDecorator;
export const Query = noopDecorator;
export class ParseIntPipe {}

export const HttpStatus = { OK: 200, BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409 } as const;

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

/** 실제 SetMetadata와 같게 메서드(또는 클래스)에 메타데이터를 단다. */
export const SetMetadata = (key: string, value: unknown) => (target: object, _prop?: string | symbol, descriptor?: PropertyDescriptor) => {
  Reflect.defineMetadata(key, value, descriptor?.value ?? target);
};
export const createParamDecorator = () => () => () => undefined;
