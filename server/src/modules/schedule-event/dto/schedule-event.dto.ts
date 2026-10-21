import { Transform } from 'class-transformer';
import { IsBoolean, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import type { ScheduleEventInput } from '@fantasteel/shared';

const DATE_MESSAGE = '날짜는 YYYY-MM-DD로 입력해 주세요';
const TIME_MESSAGE = '시각은 날짜와 시간(ISO 8601)으로 보내 주세요';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** 빈 메모는 없는 것으로 */
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class ListScheduleEventsQuery {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: DATE_MESSAGE })
  to?: string;
}

/** 내가 직접 등록·수정하는 일정. 등록과 수정이 같은 칸을 모두 받는다(수정은 화면이 전체를 다시 보낸다) */
export class ScheduleEventInputDto implements ScheduleEventInput {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '제목을 입력해 주세요' })
  @MaxLength(100)
  scheduleEventTitle!: string;

  @Transform(blankToNull)
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(1000)
  scheduleEventDescription!: string | null;

  @IsISO8601({ strict: true }, { message: TIME_MESSAGE })
  startAt!: string;

  @IsISO8601({ strict: true }, { message: TIME_MESSAGE })
  endAt!: string;

  @IsOptional()
  @IsBoolean()
  notionSync?: boolean;
}
