import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** API-159. 부서장은 등록 뒤 수정(API-160)에서 지정한다 */
export class CreateDepartmentDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '부서코드를 입력해 주세요' })
  departmentCode!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '부서 이름을 입력해 주세요' })
  departmentName!: string;

  /** 없으면 최상위 부서 */
  @IsOptional()
  @IsInt({ message: '상위 부서를 골라 주세요' })
  parentId?: number | null;
}

/** API-160. 부서코드는 바꾸지 않는다. parentId·headEmployeeId는 null이면 비우고, 보내지 않으면 그대로 둔다 */
export class UpdateDepartmentDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '부서 이름을 입력해 주세요' })
  departmentName?: string;

  @IsOptional()
  @IsInt({ message: '상위 부서를 골라 주세요' })
  parentId?: number | null;

  @IsOptional()
  @IsInt({ message: '부서장을 골라 주세요' })
  headEmployeeId?: number | null;
}
