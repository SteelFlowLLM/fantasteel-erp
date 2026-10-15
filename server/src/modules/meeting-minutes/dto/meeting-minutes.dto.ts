import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { MEETING_MINUTES_STATUS, MEETING_TITLE_MAX, MEETING_TRANSCRIPT_MAX } from '@fantasteel/shared';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** POST meeting-minutes (API-258). 제목·전사는 service가 trim한 뒤 비었는지 다시 본다 */
export class CreateMeetingMinutesDto {
  @IsString({ message: '제목을 입력해 주세요' })
  @IsNotEmpty({ message: '제목을 입력해 주세요' })
  @MaxLength(MEETING_TITLE_MAX, { message: `제목은 ${MEETING_TITLE_MAX}자까지 쓸 수 있어요` })
  meetingMinutesTitle!: string;

  @Matches(DATE_PATTERN, { message: '회의일은 YYYY-MM-DD로 입력해 주세요' })
  meetingDate!: string;

  @IsArray({ message: '참석자를 골라 주세요' })
  @ArrayMinSize(1, { message: '참석자를 1명 이상 골라 주세요' })
  @ArrayMaxSize(100, { message: '참석자는 100명까지 고를 수 있어요' })
  @IsInt({ each: true, message: '참석자 id가 올바르지 않아요' })
  attendeeIds!: number[];

  @IsString({ message: '회의 기록을 입력해 주세요' })
  @IsNotEmpty({ message: '회의 기록을 입력해 주세요' })
  @MaxLength(MEETING_TRANSCRIPT_MAX, { message: `회의 기록은 ${MEETING_TRANSCRIPT_MAX.toLocaleString('ko-KR')}자까지 넣을 수 있어요` })
  transcript!: string;
}

/**
 * POST meeting-minutes/audio. multipart의 글 칸은 모두 문자열로 온다: attendeeIds는 JSON 배열 문자열("[2,3]")이고
 * 서버(service)가 풀어서 text 만들기와 같은 검증을 한다.
 */
export class CreateMeetingMinutesAudioDto {
  @IsString({ message: '제목을 입력해 주세요' })
  @IsNotEmpty({ message: '제목을 입력해 주세요' })
  @MaxLength(MEETING_TITLE_MAX, { message: `제목은 ${MEETING_TITLE_MAX}자까지 쓸 수 있어요` })
  meetingMinutesTitle!: string;

  @Matches(DATE_PATTERN, { message: '회의일은 YYYY-MM-DD로 입력해 주세요' })
  meetingDate!: string;

  @IsString({ message: '참석자를 골라 주세요' })
  attendeeIds!: string;
}

/** GET meeting-minutes (API-259 목록) */
export class ListMeetingMinutesQuery {
  @IsOptional()
  @IsIn(Object.values(MEETING_MINUTES_STATUS), { message: '회의록 상태가 올바르지 않아요' })
  meetingMinutesStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '검색어는 100자까지 쓸 수 있어요' })
  keyword?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;
}
