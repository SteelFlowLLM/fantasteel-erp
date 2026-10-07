import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** API-156. 사원번호 형식은 문서에 정해진 것이 없어 빈 값만 막는다 */
export class CreateEmployeeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '사원번호를 입력해 주세요' })
  employeeNo!: string;

  /** bcrypt는 72바이트까지만 해시에 반영한다 */
  @IsString()
  @IsNotEmpty({ message: '비밀번호를 입력해 주세요' })
  @MaxLength(72, { message: '비밀번호는 72자 이하로 입력해 주세요' })
  password!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '이름을 입력해 주세요' })
  employeeName!: string;

  @IsInt({ message: '부서를 골라 주세요' })
  departmentId!: number;

  @IsInt({ message: '직급을 골라 주세요' })
  jobGradeId!: number;

  @IsInt({ message: '역할을 골라 주세요' })
  roleId!: number;
}

/** API-157. 사원번호는 로그인 ID라 바꾸지 않는다. 퇴사는 isActive=false (삭제하지 않음) */
export class UpdateEmployeeDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '이름을 입력해 주세요' })
  employeeName?: string;

  @IsOptional()
  @IsInt({ message: '부서를 골라 주세요' })
  departmentId?: number;

  @IsOptional()
  @IsInt({ message: '직급을 골라 주세요' })
  jobGradeId?: number;

  @IsOptional()
  @IsInt({ message: '역할을 골라 주세요' })
  roleId?: number;

  @IsOptional()
  @IsBoolean({ message: 'isActive는 true 또는 false여야 해요' })
  isActive?: boolean;
}
