import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsString, ValidateNested } from 'class-validator';
import { PERMISSION_LEVEL, type PermissionLevel } from '@fantasteel/shared';

export class PermissionEntryDto {
  @IsString()
  permissionCode: string;

  @IsIn(Object.values(PERMISSION_LEVEL))
  permissionLevel: PermissionLevel;
}

export class ReplaceRolePermissionsDto {
  /** 이 역할의 권한 전체. 목록에 없는 권한은 없어진다. */
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => PermissionEntryDto)
  permissions: PermissionEntryDto[];
}
