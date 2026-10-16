import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import type { IntegrationSettingsInput } from '@fantasteel/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateIntegrationSettingsDto implements IntegrationSettingsInput {
  /** Notion 상위 페이지 주소나 id. null·빈 문자열이면 비운다. 보내지 않으면 그대로 */
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => value !== null)
  @IsString({ message: '상위 페이지 주소나 id를 글로 보내 주세요' })
  @MaxLength(2000, { message: '상위 페이지 주소가 너무 길어요' })
  parentPage?: string | null;
}

/** OAuth 서버가 브라우저를 돌려보내며 붙이는 쿼리. 모르는 칸이 와도 거절하지 않게 controller에서 직접 읽는다 */
export interface OAuthCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}
