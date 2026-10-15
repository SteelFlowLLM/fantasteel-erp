import { IsOptional, Matches } from 'class-validator';

const DATE_MESSAGE = '날짜는 YYYY-MM-DD로 입력해 주세요';

export class ListScheduleEventsQuery {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: DATE_MESSAGE })
  to?: string;
}
