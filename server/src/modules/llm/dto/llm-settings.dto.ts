import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** 사내망·LM Studio(127.0.0.1)도 써야 해서 최상위 도메인을 요구하지 않는다 */
const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true, require_tld: false };
const URL_MESSAGE = 'http:// 또는 https://로 시작하는 주소를 입력해 주세요';

export class UpdateLlmSettingsDto {
  @Transform(trim)
  @IsUrl(URL_OPTIONS, { message: URL_MESSAGE })
  baseUrl!: string;

  /** null이면 모델 선택을 비운다 */
  @Transform(trim)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsNotEmpty({ message: '모델을 골라 주세요' })
  model!: string | null;

  /** 보내지 않으면 그대로, 빈 문자열이면 지운다 */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  apiKey?: string;
}

export class TestLlmConnectionDto {
  @Transform(trim)
  @IsUrl(URL_OPTIONS, { message: URL_MESSAGE })
  baseUrl!: string;

  /** 보내지 않으면 저장된 API 키를 쓴다 */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  apiKey?: string;
}
