import { Body, Controller, Get, Put } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { UpdateProductionSettingDto } from './dto/update-production-setting.dto';
import { ProductionSettingService } from './production-setting.service';

@Controller('production-settings')
export class ProductionSettingController {
  constructor(private readonly service: ProductionSettingService) {}

  @Get() @RequireView(PERMISSION.MASTER_MANAGE)
  get() { return this.service.get(); }

  @Put() @RequireUse(PERMISSION.MASTER_MANAGE)
  update(@Body() dto: UpdateProductionSettingDto, @CurrentUser() user: AuthUser) { return this.service.update(dto, user); }
}
