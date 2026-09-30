import { IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { EMPLOYEE_STATUS } from '@fantasteel/shared';

// 생략(undefined) = 변경 없음. email만 null로 비울 수 있다.
export class UpdateEmployeeDto {
  @ValidateIf((_o, v) => v !== undefined) @IsString() @MinLength(1) @MaxLength(50)
  employeeName?: string;

  @ValidateIf((_o, v) => v !== undefined) @IsInt()
  departmentId?: number;

  @ValidateIf((_o, v) => v !== undefined) @IsInt()
  roleId?: number;

  @ValidateIf((_o, v) => v !== undefined) @IsString() @MinLength(1) @MaxLength(20)
  jobGrade?: string;

  @IsOptional() @IsEmail() @MaxLength(100)
  email?: string | null;

  /** 잠김(LOCKED)은 로그인 실패로만 생긴다. 여기서는 사용/사용 중지만 지정한다. */
  @ValidateIf((_o, v) => v !== undefined) @IsIn([EMPLOYEE_STATUS.ACTIVE, EMPLOYEE_STATUS.INACTIVE])
  employeeStatus?: string;
}
