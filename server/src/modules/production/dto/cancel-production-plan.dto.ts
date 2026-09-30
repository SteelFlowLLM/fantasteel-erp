import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelProductionPlanDto {
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}
