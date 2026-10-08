# 서버 모듈별 작업 안내

모듈마다 한 장씩: 담당 요구사항·업무, 쓰는 테이블, 만들 API, 업무 규칙, 오류 코드, 작업 로그 이벤트, 다른 모듈과의 경계, 필수 테스트, 확인 필요 사항. 실행 방법과 공통 규칙은 [../SERVER-GUIDE.md](../SERVER-GUIDE.md).

| 모듈 | 안내 | 범위 | 담당 |
|---|---|---|---|
| auth | [auth.md](auth.md) | 로그인·로그아웃·내 정보 (**구현됨**) | |
| organization | [organization.md](organization.md) | 사원·부서·직급·역할 권한·조직도 | |
| master-data | [master-data.md](master-data.md) | 강종·품목·규격·매핑·라우팅·원단위·거래처·야드·설정값 | |
| sales-order | [sales-order.md](sales-order.md) | 수주 등록·충족 현황·취소 | |
| inventory | [inventory.md](inventory.md) | 재고·예약·배정(출하·열연) | |
| production | [production.md](production.md) | 생산계획·히트 편성·작업 실적·실적 시뮬레이션·재생산 | |
| mrp | [mrp.md](mrp.md) | MRP 소요량 계산 조회 | |
| purchasing | [purchasing.md](purchasing.md) | 구매요청·부서장 승인·발주·입고 | |
| lot | [lot.md](lot.md) | LOT 조회·정·역추적 | |
| quality | [quality.md](quality.md) | 검사 기준·검사·자동 판정·불합격 처리 | |
| shipment | [shipment.md](shipment.md) | 출하요청·출고 확정·밀시트 | |
| business-event | [business-event.md](business-event.md) | 작업 로그 조회·이력 재현 | |
| dashboard | [dashboard.md](dashboard.md) | 대시보드 위젯 조회(P3) | |
| notification | [notification.md](notification.md) | 업무·알림 | |
| messenger | [messenger.md](messenger.md) | 채팅방·메시지·첨부·읽음·실시간 | |
| message-action | [message-action.md](message-action.md) | Message → ERP 구매요청 초안 | |

시드 내용과 테스트 계정: [seed.md](seed.md). 담당 칸은 역할 분담이 정해지면 채운다 (기획안: 역할 분담 TBD).

## 세팅 때 정한 값 (설계 문서에 없거나 문서끼리 달라서 정한 것, 팀 확인 대상)

| 항목 | 정한 값 | 이유 |
|---|---|---|
| 기준 데이터 모델 | ERD(`docs/erd/fantasteel_erp_p1.dbml`) 그대로. 업무 프로세스 정의서 11장과 다르면 ERD | ERD가 설계 결정을 반영한 최신본 (Project Note "설계 결정") |
| 채번 방식 | 같은 앞부분 최댓값 + 1. 동시에 같은 번호면 unique 위반 → `COM-001`(다시 시도) | ERD에 채번 카운터 테이블이 없음 (정의서 9.2의 DB 카운터는 구현 제안) |
| 요청 고유키(중복 요청 방지) | 만들지 않음 | ERD에 테이블이 없고 API 명세서 공통 규약에서 🟡 미정 |
| 오류 코드 추가 4개 | `AUTH-001` 로그인 실패(401), `AUTH-002` 로그인 필요(401), `COM-004` 입력 형식 오류(400), `COM-999` 서버 오류(500) | 정의서 9.3에 없지만 공통 기반에 필요 (`shared/src/errors.ts`) |
| 오류 HTTP 상태 | 정의서에 (409)로 적힌 것은 그대로. 나머지: 상태 충돌(INV·PUR·MST-002·COM-001) 409, 권한 COM-002 403, 참조 없음 COM-003 404, SHP-001 500, 그 외 400 | 정의서에 없음 |
| API 경로 | 모두 `/api/v1` 아래. API 명세서 일부 행의 `/api/...`(v1 없음)도 `/api/v1`로 만든다 | 코드 컨벤션 5장 [강제] |
| 인증 | access token은 httpOnly·Secure·SameSite=Lax 쿠키 `access_token`. 만료는 `.env`의 `JWT_EXPIRES_IN`(기본 12h) | 컨벤션 6장. 만료·갱신 방식은 비기능 요구사항 결정 후 |
| 권한 검사 | 요청마다 DB에서 역할 권한을 다시 읽는다 (관리자가 권한을 바꾸면 바로 반영) | REQ-AUTH-003 "API마다 권한 재확인" |
| 공통 코드 | 공통 코드 정의서 2장을 그대로 생성. 강종(STEEL_GRADE)은 테이블로 관리해 상수 없음. 3장(제안)은 넣지 않음 | 정의서 1·4장 |
| CHECK 제약 | ERD Note의 CHECK·부분 unique 전부 + 예약·배정·초안 상태값 CHECK | 컨벤션 4장 [권장] |
| 린터·포매터·Husky | 아직 없음 | 패키지를 새로 설치해야 해서 팀 합의 후 추가 (컨벤션 10장) |
