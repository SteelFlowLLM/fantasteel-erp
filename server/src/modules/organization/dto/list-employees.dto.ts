import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { EMPLOYEE_STATUS, ROLE_CODES } from '@fantasteel/shared';

export class ListEmployeesDto {
  @IsOptional() @Type(() => Number) @IsInt()
  departmentId?: number;

  @IsOptional() @IsIn(ROLE_CODES)
  roleCode?: string;

  @IsOptional() @IsIn(Object.values(EMPLOYEE_STATUS))
  employeeStatus?: string;

  /** 이름 또는 사원번호에 포함된 글자 */
  @IsOptional() @IsString()
  keyword?: string;
}
