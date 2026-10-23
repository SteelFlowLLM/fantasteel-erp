import { applyDecorators } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { LLM_API_KEYS_MAX, LLM_START_SITE_PATTERN, LLM_START_SITES_MAX } from '@fantasteel/shared';
import { IsAllowedServerHost } from '../../../common/net/server-url';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, Matches, IsNotEmpty, IsOptional, IsString, IsUrl, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/**
 * 사내망·LM Studio(127.0.0.1)·Tailscale(100.x.x.x)도 써야 해서 최상위 도메인을 요구하지 않고 사설 주소도 막지 않는다.
 * 다만 클라우드 메타데이터가 있는 링크 로컬(169.254.x.x)·metadata 이름은 막는다 (이슈 #497): 저장과 연결 확인 둘 다 이 서버가 그 주소로 요청을 보낸다.
 */
const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true, require_tld: false };
const URL_MESSAGE = 'http:// 또는 https://로 시작하는 주소를 입력해 주세요';

/** 저장된 키는 id로, 새 키는 값(value)으로. 둘 중 하나만 */
export class LlmApiKeyInputDto {
  @ValidateIf((o: LlmApiKeyInputDto) => o.value === undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  id?: string;

  @ValidateIf((o: LlmApiKeyInputDto) => o.id === undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'API 키를 넣어 주세요' })
  @MaxLength(500)
  value?: string;
}

/** 보내지 않으면 그 주소에 저장된 키를 그대로, 빈 배열이면 모두 지운다. 보낸 순서가 쓰는 순서 */
function ApiKeysField(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    IsArray(),
    ArrayMaxSize(LLM_API_KEYS_MAX, { message: `API 키는 ${LLM_API_KEYS_MAX}개까지 넣을 수 있어요` }),
    ValidateNested({ each: true }),
    Type(() => LlmApiKeyInputDto),
  );
}

export class UpdateLlmSettingsDto {
  @Transform(trim)
  @IsUrl(URL_OPTIONS, { message: URL_MESSAGE })
  @IsAllowedServerHost('AI 서버')
  baseUrl!: string;

  /** null이면 모델 선택을 비운다 */
  @Transform(trim)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsNotEmpty({ message: '모델을 골라 주세요' })
  model!: string | null;

  @ApiKeysField()
  apiKeys?: LlmApiKeyInputDto[];

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
  @IsAllowedServerHost('AI 서버')
  baseUrl!: string;

  /** 보내지 않으면 그 주소에 저장된 API 키를 쓴다 */
  @ApiKeysField()
  apiKeys?: LlmApiKeyInputDto[];
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
