import { IsInt, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

// 생략(undefined) = 변경 없음, null = 비움(상위 부서 없음·부서장 없음).
export class UpdateDepartmentDto {
  @ValidateIf((_o, v) => v !== undefined) @IsString() @MinLength(1) @MaxLength(50)
  departmentName?: string;

  @IsOptional() @IsInt()
  parentId?: number | null;

  @IsOptional() @IsInt()
  headEmployeeId?: number | null;

  @ValidateIf((_o, v) => v !== undefined) @IsInt()
  sortOrder?: number;
}
