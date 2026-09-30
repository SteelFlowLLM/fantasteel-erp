import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { YARD_TYPE } from '@fantasteel/shared';

export class CreateYardDto {
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,29}$/, { message: '야드 코드는 영문 대문자·숫자·-·_ 로 30자 이내로 입력해 주세요' })
  yardCode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  yardName: string;

  @IsIn(Object.values(YARD_TYPE))
  yardType: string;
}
