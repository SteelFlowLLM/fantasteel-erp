import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class WorkRoomQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  salesOrderId: number;
}
