import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthUser, Permission, PermissionLevel } from '@fantasteel/shared';

export const IS_PUBLIC = 'isPublic';
/** 인증 없이 부를 수 있는 API (로그인). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_PERMISSION = 'requiredPermission';
export interface RequiredPermission { anyOf: Permission[]; level: PermissionLevel }
/** 이 중 하나의 권한을 USE로 가져야 한다 (변경 API). */
export const RequireUse = (...anyOf: Permission[]) => SetMetadata(REQUIRED_PERMISSION, { anyOf, level: 'USE' } satisfies RequiredPermission);
/** 이 중 하나의 권한을 VIEW 이상으로 가져야 한다 (조회 API). */
export const RequireView = (...anyOf: Permission[]) => SetMetadata(REQUIRED_PERMISSION, { anyOf, level: 'VIEW' } satisfies RequiredPermission);

/** 인증 가드가 넣어 둔 로그인 사원. 클라이언트가 보낸 역할·사원 ID는 신뢰하지 않는다. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
