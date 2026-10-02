import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthGuard } from './common/auth/auth.guard';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { ResponseInterceptor } from './common/http/response.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { BusinessEventModule } from './modules/business-event/business-event.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { LotModule } from './modules/lot/lot.module';
import { MasterDataModule } from './modules/master-data/master-data.module';
import { MessageActionModule } from './modules/message-action/message-action.module';
import { MessengerModule } from './modules/messenger/messenger.module';
import { MrpModule } from './modules/mrp/mrp.module';
import { NotificationModule } from './modules/notification/notification.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { ProductionModule } from './modules/production/production.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { QualityModule } from './modules/quality/quality.module';
import { SalesOrderModule } from './modules/sales-order/sales-order.module';
import { ShipmentModule } from './modules/shipment/shipment.module';
import { PrismaModule } from './prisma/prisma.module';

// 모듈은 요구사항 영역 단위 (코드 컨벤션 1장). P2 이후 모듈(factory-agent, voice-erp, ai-assistant, dashboard, past-case)은 그 단계에서 추가한다.
@Module({
  imports: [
    PrismaModule,
    CommonModule,
    AuthModule,
    OrganizationModule,
    MasterDataModule,
    SalesOrderModule,
    InventoryModule,
    ProductionModule,
    MrpModule,
    PurchasingModule,
    LotModule,
    QualityModule,
    ShipmentModule,
    BusinessEventModule,
    NotificationModule,
    MessengerModule,
    MessageActionModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
