import { ArrayNotEmpty, ArrayUnique, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

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
