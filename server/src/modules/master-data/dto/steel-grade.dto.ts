import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** API-169. 적용 규격 번호는 ERD에서 not null (밀시트 표시) */
export class CreateSteelGradeDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9][A-Z0-9-]*$/, { message: '강종 코드는 영문 대문자·숫자·하이픈으로 입력해 주세요 (예: SM355A)' })
  steelGradeCode!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '강종 이름을 입력해 주세요' })
  steelGradeName!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '적용 규격 번호를 입력해 주세요' })
  standardNo!: string;
}
