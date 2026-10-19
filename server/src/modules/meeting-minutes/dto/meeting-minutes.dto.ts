import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { MEETING_MINUTES_STATUS, MEETING_SUMMARY_MAX, MEETING_TITLE_MAX, MEETING_TRANSCRIPT_MAX } from '@fantasteel/shared';

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

/**
 * POST meeting-minutes/audio/from-drive (이슈 #361). 음성 올리기와 같은 칸이지만 JSON이라 attendeeIds는 숫자 배열이다.
 * driveFileId는 설정한 Drive 폴더 안의 녹음 (GET integrations/google-drive/files?kind=audio의 id).
 */
export class CreateMeetingMinutesFromDriveDto {
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

  @IsString({ message: 'Drive 녹음 파일을 골라 주세요' })
  @Matches(/^[A-Za-z0-9_-]{10,200}$/, { message: 'Drive 파일 id가 올바르지 않아요' })
  driveFileId!: string;
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

/** PATCH meeting-minutes/:id/candidates/:key 의 구매요청 칸. 값의 뜻(원료 여부·날짜 범위)은 service가 검증한다 */
export class MeetingCandidatePurchaseDto {
  @IsOptional()
  @IsInt({ message: '원료 품목이 올바르지 않아요' })
  itemId?: number;

  @IsOptional()
  @IsString({ message: '수량(톤)이 올바르지 않아요' })
  requestedTon?: string;

  @IsOptional()
  @IsString({ message: '희망 입고일이 올바르지 않아요' })
  desiredReceiptDate?: string;
}

/** PATCH meeting-minutes/:id/candidates/:key. 보낸 칸만 바꾼다 */
export class UpdateMeetingCandidateDto {
  @IsOptional()
  @IsString({ message: '제목이 올바르지 않아요' })
  @MaxLength(200, { message: '제목은 200자까지 쓸 수 있어요' })
  title?: string;

  @IsOptional()
  @IsString({ message: '설명이 올바르지 않아요' })
  @MaxLength(1000, { message: '설명은 1000자까지 쓸 수 있어요' })
  description?: string | null;

  @IsOptional()
  @IsInt({ message: '담당자가 올바르지 않아요' })
  assigneeId?: number;

  @IsOptional()
  @Matches(DATE_PATTERN, { message: '마감일은 YYYY-MM-DD로 입력해 주세요' })
  dueDate?: string;

  @IsOptional()
  @IsString({ message: '시작 시각이 올바르지 않아요' })
  startAt?: string;

  @IsOptional()
  @IsString({ message: '끝 시각이 올바르지 않아요' })
  endAt?: string;

  @IsOptional()
  @IsArray({ message: '참석자를 골라 주세요' })
  @ArrayMaxSize(100, { message: '참석자는 100명까지 고를 수 있어요' })
  @IsInt({ each: true, message: '참석자 id가 올바르지 않아요' })
  attendeeIds?: number[];

  @IsOptional()
  @ValidateNested()
  @Type(() => MeetingCandidatePurchaseDto)
  purchase?: MeetingCandidatePurchaseDto;

  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'EXCLUDED'], {
    message: '허가 상태가 올바르지 않아요',
  })
  decision?: 'PENDING' | 'APPROVED' | 'EXCLUDED';
}

/** PATCH meeting-minutes/:id/summary */
export class UpdateMeetingSummaryDto {
  @IsString({ message: '요약을 입력해 주세요' })
  @MaxLength(MEETING_SUMMARY_MAX, {
    message: `요약은 ${MEETING_SUMMARY_MAX}자까지 쓸 수 있어요`,
  })
  summary!: string;
}

/** PATCH meeting-minutes/:id/speakers. 값(사원 id 또는 null)의 모양은 service가 본다: 키가 임의라 class-validator로 표현하기 어렵다 */
export class UpdateMeetingSpeakersDto {
  @IsObject({ message: '화자 연결 정보가 올바르지 않아요' })
  mapping!: Record<string, number | null>;
}
