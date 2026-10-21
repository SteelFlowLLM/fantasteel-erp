import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/**
 * 사내망·whisper.cpp(127.0.0.1)·같은 망 PC(192.168.x.x)·Tailscale(100.x.x.x, *.ts.net)도 써야 해서 최상위 도메인을 요구하지 않고 주소 범위도 막지 않는다.
 * 관리자(ORG_MANAGE)가 직접 넣는 서버 설정이라, 철강맨AI 웹 도구의 사설 주소 차단 규칙과는 따로다.
 */
const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true, require_tld: false };
const URL_MESSAGE = 'http:// 또는 https://로 시작하는 주소를 입력해 주세요';

export class UpdateSttSettingsDto {
  @Transform(trim)
  @IsUrl(URL_OPTIONS, { message: URL_MESSAGE })
  baseUrl!: string;

  /** null이거나 빈 문자열이면 모델 이름을 보내지 않는다(whisper.cpp) */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value))
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100)
  model!: string | null;

  /** 보내지 않으면 그대로, 빈 문자열이면 지운다 */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  apiKey?: string;
}

export class TestSttConnectionDto {
  @Transform(trim)
  @IsUrl(URL_OPTIONS, { message: URL_MESSAGE })
  baseUrl!: string;

  /** 보내지 않으면 저장된 모델을 쓰고, 빈 문자열·null이면 모델 이름 없이 확인한다 */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value))
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100)
  model?: string | null;

  /** 보내지 않으면 저장된 API 키를 쓴다 */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  apiKey?: string;
}
