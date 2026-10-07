import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ROLE, type Role } from '@fantasteel/shared';

/** 사원 목록 조건. 명세는 페이징만 정했고, 거르기는 사원 관리 화면이 쓰는 조건이다 */
export class ListEmployeesQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '부서 id가 올바르지 않아요' })
  departmentId?: number;

  @IsOptional()
  @IsIn(Object.values(ROLE), { message: '역할 값이 올바르지 않아요' })
  roleCode?: Role;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'isActive는 true 또는 false여야 해요' })
  isActive?: boolean;

  /** 이름·사원번호 일부 */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  keyword?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;
}
