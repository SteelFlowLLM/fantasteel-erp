import { IsInt } from 'class-validator';

/** 매핑된 코일 규격을 바꾼다. 슬래브 규격은 바꿀 수 없다 (삭제 후 다시 등록). */
export class UpdateSpecMappingDto {
  @IsInt()
  coilSpecId: number;
}
