import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsISO8601, ValidateNested } from 'class-validator';
import { UpdateQualityInspectionValueInput } from './register-quality-inspection.dto';

export class UpdateQualityInspectionDto {
  /** 검사 상세의 updatedAt. 그 사이 다른 사람이 고쳤으면 COM-001 (동시 수정 방지, 2026-10-04 결정) */
  @IsISO8601({ strict: true }, { message: 'expectedUpdatedAt은 ISO 8601 시각이어야 해요' })
  expectedUpdatedAt!: string;

  /** 보완·고칠·지울(null) 항목만 보낸다. 보내지 않은 항목의 기존 값은 그대로 둔다 */
  @IsArray({ message: '측정값 목록은 배열이어야 해요' })
  @ArrayMinSize(1, { message: '고칠 측정값을 1개 이상 보내 주세요' })
  @ArrayMaxSize(100, { message: '측정값은 100개 이하로 보내 주세요' })
  @ValidateNested({ each: true })
  @Type(() => UpdateQualityInspectionValueInput)
  values!: UpdateQualityInspectionValueInput[];
}
