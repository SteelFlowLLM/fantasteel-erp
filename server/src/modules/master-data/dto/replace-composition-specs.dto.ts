import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CompositionSpecInputDto } from './composition-spec-input.dto';

/** PUT: 목록 전체로 교체 (목록에 없는 성분은 삭제) */
export class ReplaceCompositionSpecsDto {
  @IsArray()
  @ArrayNotEmpty({ message: '성분 규격을 1개 이상 입력해 주세요' })
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CompositionSpecInputDto)
  compositionSpecs: CompositionSpecInputDto[];
}

/** PATCH: 보낸 성분만 추가·수정, removeElementCodes에 적은 성분은 삭제 */
export class PatchCompositionSpecsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CompositionSpecInputDto)
  compositionSpecs?: CompositionSpecInputDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  removeElementCodes?: string[];
}
