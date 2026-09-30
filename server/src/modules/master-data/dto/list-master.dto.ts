import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** 사용 여부·검색어로 거르는 목록 조회 (고객사·공급업체·야드·강종 등 공통) */
export class ListMasterDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';

  @IsOptional()
  @IsString()
  @MaxLength(50)
  q?: string;
}
