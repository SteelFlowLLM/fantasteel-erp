import { Transform } from 'class-transformer';
import { LLM_START_SITE_PATTERN, LLM_START_SITES_MAX } from '@fantasteel/shared';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, Matches, IsNotEmpty, IsOptional, IsString, IsUrl, Max, MaxLength, Min, ValidateIf } from 'class-validator';

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

  /** 사진·생각 정도 지원 (LM Studio가 아닐 때만 쓴다, 이슈 #465). 보내지 않으면 그대로, null이면 모름 */
  @IsOptional()
  @IsBoolean()
  visionSupport?: boolean | null;

  @IsOptional()
  @IsBoolean()
  reasoningSupport?: boolean | null;

  /** 문맥 길이(토큰). 모델 정보가 없을 때만 쓴다. 보내지 않으면 그대로, null이면 모름 */
  @IsOptional()
  @IsInt({ message: '문맥 길이는 정수(토큰)로 넣어 주세요' })
  @Min(1024, { message: '문맥 길이는 1024토큰 이상으로 넣어 주세요' })
  @Max(10_000_000)
  contextLength?: number | null;
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

export class UpdateLlmBrowserSettingsDto {
  /** null이면 저장한 목록을 지우고 기본값으로 돌아간다. 호스트는 소문자 도메인(점 하나 이상) */
  @ValidateIf((_, value) => value !== null)
  @IsArray()
  @ArrayMaxSize(LLM_START_SITES_MAX, { message: `시작 사이트는 ${LLM_START_SITES_MAX}개까지예요` })
  @Transform(({ value }) => (Array.isArray(value) ? value.map((host) => (typeof host === 'string' ? host.trim().toLowerCase() : host)) : value))
  @Matches(LLM_START_SITE_PATTERN, { each: true, message: '시작 사이트는 소문자 도메인(예: kosis.kr)으로 적어 주세요' })
  startSites!: string[] | null;

  @IsBoolean()
  openAllSites!: boolean;
}
