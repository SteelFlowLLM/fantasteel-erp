import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** API-162 */
export class CreateJobGradeDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: '직급 이름을 입력해 주세요' })
  jobGradeName!: string;

  @IsInt({ message: '표시 순서는 정수로 입력해 주세요' })
  sortOrder!: number;
}

/** API-272. 보내지 않은 칸은 그대로 둔다 */
export class UpdateJobGradeDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: '직급 이름을 입력해 주세요' })
  jobGradeName?: string;

  @IsOptional()
  @IsInt({ message: '표시 순서는 정수로 입력해 주세요' })
  sortOrder?: number;
}
