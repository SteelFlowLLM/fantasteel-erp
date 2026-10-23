import { Type } from 'class-transformer';
import { ArrayNotEmpty, ArrayUnique, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ConfirmHotRollingDto {
  @ArrayNotEmpty({ message: '배정할 슬래브를 하나 이상 골라 주세요' })
  @ArrayUnique({ message: '같은 슬래브를 두 번 고를 수 없어요' })
  @IsInt({ each: true, message: 'LOT id는 정수예요' })
  lotIds!: number[];
}

export class ReleaseHotRollingDto {
  /** 있으면 변경(기존 해제 + 새 슬래브 확정), 없으면 해제 */
  @IsOptional()
  @IsInt({ message: '새 LOT id는 정수예요' })
  @Min(1, { message: '새 LOT id는 1 이상이어야 해요' })
  newLotId?: number;

  @IsOptional()
  @IsString({ message: '사유는 문자열이어야 해요' })
  @MaxLength(200, { message: '사유는 200자까지 쓸 수 있어요' })
  reason?: string;
}

/** 열연 투입 목록(코일 계획) 페이징 */
export class ListHotRollingPlansDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page는 정수여야 해요' })
  @Min(1, { message: 'page는 1 이상이어야 해요' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'size는 정수여야 해요' })
  @Min(1, { message: 'size는 1 이상이어야 해요' })
  @Max(100, { message: 'size는 100 이하여야 해요' })
  size?: number;
}
