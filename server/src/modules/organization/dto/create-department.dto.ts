import { IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateDepartmentDto {
  @Matches(/^[A-Z0-9][A-Z0-9-]{0,29}$/, { message: '부서 코드는 영문 대문자·숫자·하이픈 30자 이내로 입력해 주세요' })
  departmentCode: string;

  @IsString() @MinLength(1) @MaxLength(50)
  departmentName: string;

  @IsOptional() @IsInt()
  parentId?: number | null;

  @IsOptional() @IsInt()
  headEmployeeId?: number | null;

  @IsOptional() @IsInt()
  sortOrder?: number;
}
