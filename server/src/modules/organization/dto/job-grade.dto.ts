import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString } from 'class-validator';

/** API-162 */
export class CreateJobGradeDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: '직급 이름을 입력해 주세요' })
  jobGradeName!: string;

  @IsInt({ message: '표시 순서는 정수로 입력해 주세요' })
  sortOrder!: number;
}
