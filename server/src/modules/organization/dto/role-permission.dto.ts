import { Type } from 'class-transformer';
import { IsArray, IsIn, ValidateNested } from 'class-validator';
import { PERMISSION, PERMISSION_LEVEL, type Permission, type PermissionLevel } from '@fantasteel/shared';

export class RolePermissionItemDto {
  @IsIn(Object.values(PERMISSION), { message: '권한 값이 올바르지 않아요' })
  permission!: Permission;

  @IsIn(Object.values(PERMISSION_LEVEL), { message: '권한 수준은 USE 또는 VIEW여야 해요' })
  permissionLevel!: PermissionLevel;
}

/** API-164. 이 목록으로 역할의 권한을 통째로 바꾼다. 빠진 권한은 행을 지운다 (권한이 없으면 행을 두지 않음) */
export class UpdateRolePermissionsDto {
  @IsArray({ message: '권한 목록을 보내 주세요' })
  @ValidateNested({ each: true })
  @Type(() => RolePermissionItemDto)
  permissions!: RolePermissionItemDto[];
}
