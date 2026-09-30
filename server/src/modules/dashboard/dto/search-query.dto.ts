import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(60, { message: '검색어는 60자 이하로 입력해 주세요' })
  q?: string;
}
