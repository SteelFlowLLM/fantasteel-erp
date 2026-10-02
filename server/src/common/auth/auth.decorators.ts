import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthUser, Permission, PermissionLevel } from '@fantasteel/shared';

export const IS_PUBLIC = 'isPublic';
/** 인증 없이 부를 수 있는 API. 로그인에만 쓴다. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_PERMISSION = 'requiredPermission';
export interface RequiredPermission {
  permission: Permission;
  level: PermissionLevel;
}
/**
 * 기능 권한 확인 (코드 컨벤션 6장). 변경 API는 'USE', 조회 API는 'VIEW'(VIEW 또는 USE면 통과).
 *   @RequirePermission(PERMISSION.SALES_ORDER_CREATE, 'USE')
 * 구매요청 승인은 권한 코드가 아니라 service에서 부서장인지 확인한다 (department-head.ts).
 */
export const RequirePermission = (permission: Permission, level: PermissionLevel) =>
  SetMetadata(REQUIRED_PERMISSION, { permission, level } satisfies RequiredPermission);

/** 인증 가드가 넣어 둔 로그인 사원. 클라이언트가 보낸 사원 id·역할은 쓰지 않는다. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
