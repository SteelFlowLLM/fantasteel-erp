# LOT 정·역추적

API ID: API-237
Method: GET
Path: /api/v1/lots/:id/trace
관련 BP: BP-LOT-01
권한: 없음 (LOT 추적은 전 역할)
도메인: LOT·로그
등급: P1
비고: 12.2 명시(?direction=). lot_relation 내부 ID로 조회, 번호 파싱 금지 (BP-LOT-01)
설명: 코일→원료 역추적, 원료·히트→슬래브·코일·출하 정추적. 합금철 포함 (REQ-LOT-005)
인증: AUTHENTICATED
작성 상태: 초안