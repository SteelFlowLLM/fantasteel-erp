import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MESSAGE_CONTENT_MAX_LENGTH } from './post-message.dto';

export class UploadFileDto {
  /** 파일과 함께 보내는 말. 없으면 파일 이름이 내용이 된다. */
  @IsOptional()
  @IsString()
  @MaxLength(MESSAGE_CONTENT_MAX_LENGTH)
  content?: string;
}
