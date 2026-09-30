import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** 야드 종류는 재고·규격이 참조하므로 바꿀 수 없다. 야드 내 위치는 관리하지 않는다 (REQ-MST-008). */
export class UpdateYardDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  yardName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
