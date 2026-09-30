import { Module } from '@nestjs/common';
import { LotGraphService } from './lot-graph.service';
import { LotRepository } from './lot.repository';

/**
 * LOT 관계(lot_relation) 탐색만 따로 내보내는 모듈 (컨트롤러 없음). business-event가 이것만 import 한다.
 * LotModule(컨트롤러 있음)을 business-event가 import 하면 Nest가 LotController를 앞 순서로 등록해서,
 * 다른 모듈의 `GET /lots/rejected` 보다 `GET /lots/:id` 가 먼저 잡히기 때문이다.
 */
@Module({ providers: [LotRepository, LotGraphService], exports: [LotGraphService] })
export class LotGraphModule {}
