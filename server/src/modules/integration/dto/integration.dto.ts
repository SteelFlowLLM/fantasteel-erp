import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { DRIVE_FILE_KINDS, type DriveFileKind, type IntegrationSettingsInput, type NotionCalendarSettingsInput } from '@fantasteel/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * PUT integrations/:providerKey/settings. 연결 대상마다 쓰는 칸이 다르고, 다른 연결 대상의 칸을 보내면 service가 COM-004로 거절한다.
 * 모든 칸: 보내지 않으면 그대로, null·빈 문자열이면 비운다.
 */
export class UpdateIntegrationSettingsDto implements IntegrationSettingsInput {
  /** Notion 상위 페이지 주소나 id */
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => value !== null)
  @IsString({ message: '상위 페이지 주소나 id를 글로 보내 주세요' })
  @MaxLength(2000, { message: '상위 페이지 주소가 너무 길어요' })
  parentPage?: string | null;

  /** Google Drive OAuth 클라이언트 id */
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => value !== null)
  @IsString({ message: 'OAuth 클라이언트 id를 글로 보내 주세요' })
  @MaxLength(200, { message: 'OAuth 클라이언트 id가 너무 길어요' })
  clientId?: string | null;

  /** Google Drive OAuth client secret (저장만 하고 돌려주지 않는다) */
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => value !== null)
  @IsString({ message: 'client secret을 글로 보내 주세요' })
  @MaxLength(200, { message: 'client secret이 너무 길어요' })
  clientSecret?: string | null;

  /** Google Drive 녹음·사진 폴더 주소나 id */
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => value !== null)
  @IsString({ message: 'Drive 폴더 주소나 id를 글로 보내 주세요' })
  @MaxLength(2000, { message: 'Drive 폴더 주소가 너무 길어요' })
  folder?: string | null;
}

/**
 * PUT integrations/notion/calendar (이슈 #391 2단계). accountId·calendarId를 함께 주면 그 캘린더로 바꾸고, accountId가 null이면 캘린더 반영을 끈다.
 * sendInvites만 주면 초대 여부만 바꾼다.
 */
export class UpdateNotionCalendarDto implements NotionCalendarSettingsInput {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString({ message: '캘린더 계정을 골라 주세요' })
  @IsNotEmpty({ message: '캘린더 계정을 골라 주세요' })
  @MaxLength(500)
  accountId?: string | null;

  @IsOptional()
  @IsString({ message: '캘린더를 골라 주세요' })
  @IsNotEmpty({ message: '캘린더를 골라 주세요' })
  @MaxLength(1000)
  calendarId?: string;

  @IsOptional()
  @IsBoolean({ message: '초대 여부는 true 또는 false여야 해요' })
  sendInvites?: boolean;
}

/** GET integrations/google-drive/files */
export class ListDriveFilesQuery {
  @IsIn(DRIVE_FILE_KINDS, { message: 'kind는 audio 또는 image예요' })
  kind!: DriveFileKind;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'pageToken이 너무 길어요' })
  pageToken?: string;
}

/** OAuth 서버가 브라우저를 돌려보내며 붙이는 쿼리. 모르는 칸이 와도 거절하지 않게 controller에서 직접 읽는다 */
export interface OAuthCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}
