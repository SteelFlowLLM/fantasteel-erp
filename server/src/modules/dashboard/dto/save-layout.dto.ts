import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsString, ValidateNested } from 'class-validator';
import { WIDGETS } from '@fantasteel/shared';

// 값의 범위(x ≥ 0, w ≥ 1, x + w ≤ 12 …)와 중복은 서비스에서 한국어 메시지로 검사한다 (dashboard-layout.ts).
export class WidgetPlacementDto {
  @IsString({ message: '위젯 코드를 입력해 주세요' })
  widgetCode: string;

  @IsInt({ message: 'x는 정수여야 합니다' })
  x: number;

  @IsInt({ message: 'y는 정수여야 합니다' })
  y: number;

  @IsInt({ message: 'w는 정수여야 합니다' })
  w: number;

  @IsInt({ message: 'h는 정수여야 합니다' })
  h: number;
}

export class SaveLayoutDto {
  @IsArray({ message: 'placements는 배열이어야 합니다' })
  @ArrayMaxSize(WIDGETS.length, { message: `위젯은 ${WIDGETS.length}개까지만 배치할 수 있습니다` })
  @ValidateNested({ each: true })
  @Type(() => WidgetPlacementDto)
  placements: WidgetPlacementDto[];
}
