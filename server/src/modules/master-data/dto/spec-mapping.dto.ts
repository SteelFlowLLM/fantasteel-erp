import { IsInt } from 'class-validator';

/** API-171. 슬래브 규격 1개에 코일 규격 1개 (REQ-MST-004) */
export class CreateSpecMappingDto {
  @IsInt({ message: '슬래브 규격을 골라 주세요' })
  slabItemId!: number;

  @IsInt({ message: '코일 규격을 골라 주세요' })
  coilItemId!: number;
}
