import { IsDateString, IsInt, IsOptional } from 'class-validator';

/** API-171. 슬래브 규격 1개에 코일 규격 1개 (REQ-MST-004) */
export class CreateSpecMappingDto {
  @IsInt({ message: '슬래브 규격을 골라 주세요' })
  slabItemId!: number;

  @IsInt({ message: '코일 규격을 골라 주세요' })
  coilItemId!: number;
}

/** 규격 매핑 수정: 등록과 같은 두 칸을 다시 받는다. 수주·재고·예약·생산계획·LOT이 쓰는 규격의 매핑은 바꾸지 못한다 */
export class UpdateSpecMappingDto extends CreateSpecMappingDto {
  /** 불러온 시각. 그 사이 다른 사람이 고쳤으면 COM-001 */
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'expectedUpdatedAt은 시각(ISO 8601)으로 보내 주세요' })
  expectedUpdatedAt?: string | null;
}
