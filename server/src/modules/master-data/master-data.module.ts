import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { InspectionItemController } from './inspection-item.controller';
import { InspectionItemRepository } from './inspection-item.repository';
import { InspectionItemService } from './inspection-item.service';
import { ItemController } from './item.controller';
import { ItemRepository } from './item.repository';
import { ItemService } from './item.service';
import { LookupRepository } from './lookup.repository';
import { LookupService } from './lookup.service';
import { MasterChangeRecorder } from './master-change.recorder';
import { MasterDataController } from './master-data.controller';
import { PartyRepository } from './party.repository';
import { ProductSpecController } from './product-spec.controller';
import { ProductSpecRepository } from './product-spec.repository';
import { ProductSpecService } from './product-spec.service';
import { ProductionSettingController } from './production-setting.controller';
import { ProductionSettingService } from './production-setting.service';
import { RawMaterialController } from './raw-material.controller';
import { RawMaterialRepository } from './raw-material.repository';
import { RawMaterialService } from './raw-material.service';
import { ReadinessRepository } from './readiness.repository';
import { RoutingController } from './routing.controller';
import { RoutingRepository } from './routing.repository';
import { RoutingService } from './routing.service';
import { SpecMappingController } from './spec-mapping.controller';
import { SpecMappingRepository } from './spec-mapping.repository';
import { SpecMappingService } from './spec-mapping.service';
import { SpecificConsumptionController } from './specific-consumption.controller';
import { SpecificConsumptionRepository } from './specific-consumption.repository';
import { SpecificConsumptionService } from './specific-consumption.service';
import { SteelGradeController } from './steel-grade.controller';
import { SteelGradeRepository } from './steel-grade.repository';
import { SteelGradeService } from './steel-grade.service';
import { SupplierController } from './supplier.controller';
import { SupplierService } from './supplier.service';
import { ValidationService } from './validation.service';
import { YardController } from './yard.controller';
import { YardService } from './yard.service';

@Module({
  controllers: [
    MasterDataController, ItemController, RawMaterialController, SteelGradeController, ProductSpecController, SpecMappingController,
    RoutingController, SpecificConsumptionController, CustomerController, SupplierController, YardController, ProductionSettingController, InspectionItemController,
  ],
  providers: [
    MasterChangeRecorder, LookupRepository, LookupService, ReadinessRepository, ValidationService,
    ItemRepository, ItemService, RawMaterialRepository, RawMaterialService, SteelGradeRepository, SteelGradeService,
    ProductSpecRepository, ProductSpecService, SpecMappingRepository, SpecMappingService, RoutingRepository, RoutingService,
    SpecificConsumptionRepository, SpecificConsumptionService, PartyRepository, CustomerService, SupplierService, YardService,
    ProductionSettingService, InspectionItemRepository, InspectionItemService,
  ],
  exports: [],
})
export class MasterDataModule {}
