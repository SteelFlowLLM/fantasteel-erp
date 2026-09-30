import { IsEmail, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateEmployeeDto {
  @Matches(/^\d{7}$/, { message: '사원번호는 숫자 7자리로 입력해 주세요' })
  employeeNo: string;

  @IsString() @MinLength(1) @MaxLength(50)
  employeeName: string;

  @IsInt()
  departmentId: number;

  @IsInt()
  roleId: number;

  @IsString() @MinLength(1) @MaxLength(20)
  jobGrade: string;

  @IsOptional() @IsEmail() @MaxLength(100)
  email?: string;

  /** 초기 비밀번호. bcrypt 입력 한도(72바이트) 안에서 8자 이상 */
  @IsString() @MinLength(8) @MaxLength(72)
  initialPassword: string;
}
