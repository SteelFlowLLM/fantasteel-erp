import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelShipmentRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
