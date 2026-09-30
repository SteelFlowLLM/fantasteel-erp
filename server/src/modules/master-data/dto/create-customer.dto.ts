import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,29}$/, { message: '고객사 코드는 영문 대문자·숫자·-·_ 로 30자 이내로 입력해 주세요' })
  customerCode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  customerName: string;
}
