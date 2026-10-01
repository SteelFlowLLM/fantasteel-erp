// 가짜 서버 업무 서비스 모음 (core-domain). 화면 api 파일은 여기서 가져온다. 설명은 docs/rework/areas/core-domain.md.
// 쓰기: fn(tx, actor, input) — api 층이 requireActor로 권한을 먼저 확인하고 userActor(employee.id)를 넘긴다.
// 읽기: fn(tables, input) — mockQuery(reader) 안에서 부른다.
export * from '@/mock/services/context';
export * from '@/mock/services/inventoryPool';
export * from '@/mock/services/allocations';
export * from '@/mock/services/reservations';
export * from '@/mock/services/productionPlans';
export * from '@/mock/services/productionResults';
export * from '@/mock/services/inspections';
export * from '@/mock/services/rolling';
export * from '@/mock/services/simulation';
export * from '@/mock/services/salesOrders';
export * from '@/mock/services/shipments';
export * from '@/mock/services/goodsIssues';
export * from '@/mock/services/millSheets';
export * from '@/mock/services/purchasing';
export * from '@/mock/services/mrp';
export * from '@/mock/services/actionDrafts';
export * from '@/mock/services/workRooms';
export * from '@/mock/services/inventoryViews';
export * from '@/mock/services/timelines';
export * from '@/mock/services/invariants';
export * from '@/mock/services/notifications';
