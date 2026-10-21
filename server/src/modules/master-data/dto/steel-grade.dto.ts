import { Transform } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

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

/**
 * 강종 수정. 등록과 같은 칸을 모두 다시 받는다.
 * 이름·적용 규격 번호는 언제든 고치고, 코드는 쓰는 곳(품목·배합 원단위·검사 기준·LOT)이 없을 때만 바꾼다 (규격 코드가 강종 코드로 만들어져서).
 */
export class UpdateSteelGradeDto extends CreateSteelGradeDto {
  /** 불러온 시각. 그 사이 다른 사람이 고쳤으면 COM-001 */
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'expectedUpdatedAt은 시각(ISO 8601)으로 보내 주세요' })
  expectedUpdatedAt?: string | null;
}
