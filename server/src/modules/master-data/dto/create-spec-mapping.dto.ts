import { IsInt } from 'class-validator';

export class CreateSpecMappingDto {
  @IsInt()
  slabSpecId: number;

  @IsInt()
  coilSpecId: number;
}
