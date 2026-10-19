import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { DRIVE_FILE_LIST_KINDS, type DriveFileListKind, type IntegrationSettingsInput } from '@fantasteel/shared';

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

/** GET integrations/google-drive/files */
export class ListDriveFilesQuery {
  @IsIn(DRIVE_FILE_LIST_KINDS, { message: 'kind는 all, audio, image, document 중 하나예요' })
  kind!: DriveFileListKind;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'pageToken이 너무 길어요' })
  pageToken?: string;
}

/** GET integrations/google-drive/files/:fileId/content */
export class DriveContentQuery {
  /** 1이면 열지 않고 내려받는다 (Content-Disposition: attachment) */
  @IsOptional()
  @IsIn(['0', '1'], { message: 'download는 0 또는 1이에요' })
  download?: '0' | '1';
}

/** OAuth 서버가 브라우저를 돌려보내며 붙이는 쿼리. 모르는 칸이 와도 거절하지 않게 controller에서 직접 읽는다 */
export interface OAuthCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}
