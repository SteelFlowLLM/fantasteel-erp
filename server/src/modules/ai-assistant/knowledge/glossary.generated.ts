// 이 파일은 scripts/generate-glossary.mjs가 용어 사전(docs/notion/03-용어-사전.md)에서 만든다. 손으로 고치지 않는다.
// 바꾸는 순서: 용어 사전 수정 → npm run glossary -w @fantasteel/server
import type { GlossaryTerm } from './glossary.types';

export const GLOSSARY_TERMS: readonly GlossaryTerm[] = [
  {
    "id": "TRM-001",
    "section": "공통·범위",
    "kind": "개념",
    "name": "일관제철",
    "englishName": "Integrated Steelworks",
    "abbreviation": null,
    "variableName": null,
    "definition": "원료 입고부터 제선·제강·연주·열연을 거쳐 출하까지 한 흐름으로 이어지는 철강 생산 방식",
    "businessRule": "본 프로젝트의 공정 범위. 고철 구매·슬래그 출하는 제외",
    "relatedTerms": [
      "제선",
      "제강",
      "연주",
      "열연"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-002",
    "section": "공통·범위",
    "kind": "개념",
    "name": "수주생산",
    "englishName": "Make to Order",
    "abbreviation": "MTO",
    "variableName": null,
    "definition": "고객 수주를 받은 뒤 재고로 채우지 못한 부족분만 생산하는 방식",
    "businessRule": "전 품목 MTO. 재고생산은 범위 제외",
    "relatedTerms": [
      "수주",
      "재고 우선 예약"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-003",
    "section": "공통·범위",
    "kind": "개념",
    "name": "등급",
    "englishName": "Priority Grade",
    "abbreviation": "P1/P2/P3/EX",
    "variableName": null,
    "definition": "요구사항의 구현 순서와 일정 부족 시 포기 기준을 정한 우선순위",
    "businessRule": "P1 반드시 완성, P2는 P1 이후, P3는 마지막, EX는 추가 기능. 1→2→3등급 순서로 진행",
    "relatedTerms": [],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-004",
    "section": "공통·범위",
    "kind": "개념",
    "name": "시드 데이터",
    "englishName": "Seed Data",
    "abbreviation": null,
    "variableName": null,
    "definition": "개발·시연을 위해 미리 넣어 두는 기준·거래·이력 데이터",
    "businessRule": "시드 수주는 여재가 소진되는 크기로 설계. 과거 사례 시드 포함",
    "relatedTerms": [
      "실적 시뮬레이션",
      "과거 사례"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-005",
    "section": "공정·설비",
    "kind": "공정",
    "name": "제선",
    "englishName": "Ironmaking",
    "abbreviation": null,
    "variableName": null,
    "definition": "고로에서 원료를 녹여 용선을 만드는 공정",
    "businessRule": "실적 등록 시 용선 LOT 생성",
    "relatedTerms": [
      "고로",
      "용선"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-006",
    "section": "공정·설비",
    "kind": "공정",
    "name": "제강",
    "englishName": "Steelmaking",
    "abbreviation": null,
    "variableName": null,
    "definition": "전로에서 용선의 성분을 조정하고 합금철을 넣어 용강(히트)을 만드는 공정",
    "businessRule": "실적 = 히트. 히트 성분 검사",
    "relatedTerms": [
      "전로",
      "히트",
      "합금철"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-007",
    "section": "공정·설비",
    "kind": "공정",
    "name": "연주",
    "englishName": "Continuous Casting",
    "abbreviation": null,
    "variableName": null,
    "definition": "용강을 연속 주조해 슬래브를 만드는 공정",
    "businessRule": "실적 = 슬래브. 시뮬레이션 실적의 0~5% 손실은 슬래브 매수 감소로 반영. 슬래브 표면·치수 검사",
    "relatedTerms": [
      "히트",
      "슬래브"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-008",
    "section": "공정·설비",
    "kind": "공정",
    "name": "열연",
    "englishName": "Hot Rolling",
    "abbreviation": null,
    "variableName": null,
    "definition": "슬래브를 가열·압연해 코일로 감는 공정",
    "businessRule": "필요 매수의 슬래브만 투입. 슬래브 1매 = 코일 1개(열연 수율 고정). 코일 치수·기계적 성질 검사",
    "relatedTerms": [
      "슬래브",
      "코일",
      "여재"
    ],
    "forbiddenSynonyms": [
      "압연(공정명으로)"
    ]
  },
  {
    "id": "TRM-009",
    "section": "공정·설비",
    "kind": "개념",
    "name": "고로",
    "englishName": "Blast Furnace",
    "abbreviation": null,
    "variableName": "blastFurnaceCode",
    "definition": "제선 공정의 설비",
    "businessRule": "설비 마스터 없음. 코드(예: BF2)로만 식별해 용선 LOT 채번(HM-고로-…)에 사용",
    "relatedTerms": [
      "제선",
      "용선"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-010",
    "section": "공정·설비",
    "kind": "개념",
    "name": "전로",
    "englishName": "Converter",
    "abbreviation": null,
    "variableName": "converterCode",
    "definition": "제강 공정의 설비",
    "businessRule": "설비 마스터 없음. 코드(예: BOF1)로만 식별해 히트 채번(HT-전로-…)에 사용",
    "relatedTerms": [
      "제강",
      "히트"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-011",
    "section": "기준정보",
    "kind": "엔티티",
    "name": "품목",
    "englishName": "Item",
    "abbreviation": null,
    "variableName": "item / itemCode",
    "definition": "구매·생산·재고·출하의 관리 대상",
    "businessRule": "원료·슬래브·코일을 한 테이블에서 item_type으로 구분. 품목 코드 = 원료 코드 또는 규격 코드. 단위 유형은 QTY 또는 TON. 기본 야드 1곳",
    "relatedTerms": [
      "단위 유형",
      "원료",
      "슬래브",
      "코일"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-012",
    "section": "기준정보",
    "kind": "속성",
    "name": "단위 유형",
    "englishName": "Unit Type",
    "abbreviation": null,
    "variableName": "unitType",
    "definition": "품목 수량을 세는 단위 구분",
    "businessRule": "QTY = 제품(매수, 정수) / TON = 원료(톤, 소수). 값은 공통코드",
    "relatedTerms": [
      "품목"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-013",
    "section": "기준정보",
    "kind": "엔티티",
    "name": "원료",
    "englishName": "Raw Material",
    "abbreviation": "RM",
    "variableName": "rawMaterial",
    "definition": "제선·제강에 투입하는 구매 품목(철광석, 석탄, 석회석 등 부원료, 합금철)",
    "businessRule": "톤(소수) 관리. 입고 검사·안전재고 없음. 입고 확정 시 원료 LOT 생성. 원료 코드는 영문 3자 + 숫자 2자리(예: ORE01). 원료 유형으로 구분(공통코드 RAW_MATERIAL_TYPE)",
    "relatedTerms": [
      "합금철",
      "원료 LOT",
      "배합 원단위"
    ],
    "forbiddenSynonyms": [
      "원자재"
    ]
  },
  {
    "id": "TRM-014",
    "section": "기준정보",
    "kind": "엔티티",
    "name": "합금철",
    "englishName": "Ferroalloy",
    "abbreviation": null,
    "variableName": null,
    "definition": "제강에서 강종 성분을 맞추기 위해 넣는 원료",
    "businessRule": "강종별 투입량(kg/톤) 관리. 제강 실적 시 FIFO 차감, 히트에 실제 투입으로 연결. 시드 품목은 실리코망가니즈(SMN01) 1종",
    "relatedTerms": [
      "제강",
      "강종",
      "배합 원단위"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-112",
    "section": "기준정보",
    "kind": "속성",
    "name": "원료 유형",
    "englishName": "Raw Material Type",
    "abbreviation": null,
    "variableName": "rawMaterialType",
    "definition": "원료의 종류(철광석·석탄·석회석·합금철)",
    "businessRule": "합금철은 강종별 kg/톤(용강 기준), 나머지는 공통 톤/톤(용선 기준) 원단위",
    "relatedTerms": [
      "원료",
      "합금철",
      "배합 원단위"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-015",
    "section": "기준정보",
    "kind": "엔티티",
    "name": "용선",
    "englishName": "Hot Metal",
    "abbreviation": "HM",
    "variableName": "hotMetalNo",
    "definition": "고로에서 생산한 쇳물",
    "businessRule": "원료→용선은 FIFO 차감된 원료 LOT만 기간 기반 연결, 용선→히트는 N:M(제강 시 FIFO 자동 투입). 채번 HM-고로-YYMMDD-NN",
    "relatedTerms": [
      "제선",
      "원료 LOT",
      "히트"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-016",
    "section": "기준정보",
    "kind": "엔티티",
    "name": "히트",
    "englishName": "Heat",
    "abbreviation": "HT",
    "variableName": "heatNo",
    "definition": "전로 1회 처리로 만든 용강의 생산·관리 단위",
    "businessRule": "수주 품목(강종) 기준으로 편성. 용량 250톤(용강 기준, 설정값). 용선→히트 N:M, 히트→슬래브 1:N. 채번 HT-전로-YYMMDD-NNN. 히트 성분 검사",
    "relatedTerms": [
      "용선",
      "슬래브",
      "히트 편성"
    ],
    "forbiddenSynonyms": [
      "Heat LOT"
    ]
  },
  {
    "id": "TRM-017",
    "section": "기준정보",
    "kind": "엔티티",
    "name": "슬래브",
    "englishName": "Slab",
    "abbreviation": null,
    "variableName": "slabNo",
    "definition": "연주에서 만든 판 모양 반제품",
    "businessRule": "매수 관리. 슬래브로 출하하거나 열연에 투입. 히트→슬래브 1:N. 채번 히트번호-SS. 표면·치수 검사",
    "relatedTerms": [
      "히트",
      "코일",
      "여재"
    ],
    "forbiddenSynonyms": [
      "슬라브"
    ]
  },
  {
    "id": "TRM-018",
    "section": "기준정보",
    "kind": "엔티티",
    "name": "코일",
    "englishName": "Coil",
    "abbreviation": "C",
    "variableName": "coilNo",
    "definition": "열연에서 슬래브를 압연해 감은 완제품(열연코일)",
    "businessRule": "매수 관리. 슬래브→코일 1:1. 채번 C + 슬래브번호(HT- 제외). 치수·기계적 성질 검사",
    "relatedTerms": [
      "슬래브",
      "밀시트"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-019",
    "section": "기준정보",
    "kind": "엔티티",
    "name": "강종",
    "englishName": "Steel Grade",
    "abbreviation": null,
    "variableName": "steelGrade",
    "definition": "성분과 특성으로 구분한 강의 종류",
    "businessRule": "초기 SS275, SM355A·SM355B·SM355C·SM355D, SPHC(KS 현행 명칭). 근거 KS D 3503:2026(SS275)·KS D 3515:2018(SM355A–D)·KS D 3501(SPHC, 판 연도 확인 전). 적용 규격 번호 보유. SM355는 등급별 별도 강종(충격 온도·C·P·S 상한이 다름). 시연 시드는 SM355A·B",
    "relatedTerms": [
      "성분 규격",
      "제품 규격",
      "합금철"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-113",
    "section": "기준정보",
    "kind": "속성",
    "name": "적용 규격",
    "englishName": "Applied Standard",
    "abbreviation": null,
    "variableName": "standardNo",
    "definition": "강종의 근거 KS 규격 번호(예: KS D 3515:2018)",
    "businessRule": "밀시트에 표시",
    "relatedTerms": [
      "강종",
      "밀시트"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-020",
    "section": "기준정보",
    "kind": "개념",
    "name": "성분 규격",
    "englishName": "Chemical Composition Spec",
    "abbreviation": null,
    "variableName": null,
    "definition": "강종별 화학 성분의 허용 범위",
    "businessRule": "성분별 min/max. 히트 성분 검사의 판정 기준. 변경 시 새 버전",
    "relatedTerms": [
      "강종",
      "품질검사"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-021",
    "section": "기준정보",
    "kind": "엔티티",
    "name": "제품 규격",
    "englishName": "Product Spec",
    "abbreviation": null,
    "variableName": "productSpec",
    "definition": "강종 × 두께 × 폭 × 길이로 고정한 슬래브·코일 사양",
    "businessRule": "등록된 규격만 수주 가능. 강종·두께·폭·길이 조합은 중복 불가. 사용된 규격은 치수·이론중량 수정 불가, 다른 치수는 새 규격으로 추가. 규격별 1매 이론중량 저장. 시연 시드는 SS275·SM355A·SM355B·SPHC × 슬래브 규격 3종 = 슬래브 12·코일 12(SM355C·D는 강종만 등록). 규격 코드 = 유형-강종-두께x폭x길이(예: SL-SS275-250x1500x10000)",
    "relatedTerms": [
      "강종",
      "이론중량",
      "규격 매핑"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-022",
    "section": "기준정보",
    "kind": "속성",
    "name": "이론중량",
    "englishName": "Theoretical Weight",
    "abbreviation": null,
    "variableName": "theoreticalWeightTon",
    "definition": "두께(mm) × 폭(mm) × 길이(mm) × 7.85 ÷ 10^9로 계산한 규격 1매 중량(톤)",
    "businessRule": "소수 3자리 확정값 저장. 제품 톤 = 매수 × 이론중량(계산값). 실중량 계량은 범위 제외. 예: 250 × 1,200 × 10,000mm → 23.550톤",
    "relatedTerms": [
      "제품 규격",
      "수주 품목"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-023",
    "section": "기준정보",
    "kind": "엔티티",
    "name": "규격 매핑",
    "englishName": "Spec Mapping",
    "abbreviation": null,
    "variableName": "specMapping",
    "definition": "슬래브 규격과 대응 코일 규격을 1:1로 연결한 정보",
    "businessRule": "슬래브 규격마다 코일 규격 1개. 코일 이론중량은 코일 치수로 계산하고, 열연 계획 수율 = 코일 1개 이론중량 ÷ 슬래브 1매 이론중량. 코일 이론중량은 슬래브 1매 이론중량을 넘을 수 없음",
    "relatedTerms": [
      "제품 규격",
      "열연"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-024",
    "section": "기준정보",
    "kind": "엔티티",
    "name": "라우팅",
    "englishName": "Routing",
    "abbreviation": null,
    "variableName": "routing",
    "definition": "품목 유형(코일/슬래브)별 공정 순서와 공정별 계획 수율",
    "businessRule": "공정 변경은 데이터 수정만으로 반영. 생산 경로는 수주 품목 단위로 결정",
    "relatedTerms": [
      "계획 수율",
      "수주 품목"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-025",
    "section": "기준정보",
    "kind": "속성",
    "name": "계획 수율",
    "englishName": "Planned Yield",
    "abbreviation": null,
    "variableName": "plannedYieldRate",
    "definition": "공정 투입량 대비 산출량의 계획 비율",
    "businessRule": "고정값. 열연 계획 수율은 규격 매핑에서 계산. 실적 손실은 실적 시뮬레이션으로만 반영",
    "relatedTerms": [
      "누적 계획수율",
      "라우팅"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-026",
    "section": "기준정보",
    "kind": "속성",
    "name": "누적 계획수율",
    "englishName": "Cumulative Planned Yield",
    "abbreviation": null,
    "variableName": "cumulativeYieldRate",
    "definition": "여러 공정의 계획 수율을 곱한 값",
    "businessRule": "필요 용강량 = 부족 매수 × 1매 중량 ÷ 누적 계획수율(연주·열연)",
    "relatedTerms": [
      "계획 수율",
      "히트 편성",
      "MRP"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-027",
    "section": "기준정보",
    "kind": "엔티티",
    "name": "배합 원단위",
    "englishName": "Specific Consumption",
    "abbreviation": null,
    "variableName": "specificConsumption",
    "definition": "용선 1톤당 원료 투입량과 용강(히트) 1톤당 강종별 합금철 투입량",
    "businessRule": "철광석·석탄·석회석은 공통값(용선 톤당 톤), 합금철은 강종별 kg/톤(용강 톤당). MRP에서 합금철은 ÷1,000으로 톤 환산. 시연용 가정값",
    "relatedTerms": [
      "원료",
      "합금철",
      "MRP"
    ],
    "forbiddenSynonyms": [
      "레시피",
      "배합"
    ]
  },
  {
    "id": "TRM-028",
    "section": "기준정보",
    "kind": "엔티티",
    "name": "고객사",
    "englishName": "Customer",
    "abbreviation": null,
    "variableName": "customer",
    "definition": "수주를 내는 회사",
    "businessRule": null,
    "relatedTerms": [
      "수주"
    ],
    "forbiddenSynonyms": [
      "거래처"
    ]
  },
  {
    "id": "TRM-029",
    "section": "기준정보",
    "kind": "엔티티",
    "name": "공급업체",
    "englishName": "Supplier",
    "abbreviation": null,
    "variableName": "supplier",
    "definition": "원료를 납품하는 회사",
    "businessRule": "품목별 기본 공급업체 1곳 지정. 발주는 공급업체 1곳당 1건",
    "relatedTerms": [
      "발주"
    ],
    "forbiddenSynonyms": [
      "공급사",
      "협력사"
    ]
  },
  {
    "id": "TRM-030",
    "section": "기준정보",
    "kind": "엔티티",
    "name": "야드",
    "englishName": "Yard",
    "abbreviation": null,
    "variableName": "yard",
    "definition": "원료·슬래브·코일을 보관하는 구역",
    "businessRule": "야드 구조만 관리. 야드 내 위치는 관리하지 않음. 품목별 기본 야드를 LOT 생성 시 자동 지정",
    "relatedTerms": [
      "재고"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-031",
    "section": "기준정보",
    "kind": "속성",
    "name": "히트 용량",
    "englishName": "Heat Capacity",
    "abbreviation": null,
    "variableName": "heatCapacityTon",
    "definition": "히트 1개로 생산하는 용강 기준 중량",
    "businessRule": "초기 250톤. 설정값으로 변경 가능",
    "relatedTerms": [
      "히트",
      "히트 편성"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-032",
    "section": "권한·조직",
    "kind": "엔티티",
    "name": "사원",
    "englishName": "Employee",
    "abbreviation": null,
    "variableName": "employee / employeeId",
    "definition": "로그인 계정을 가진 사용자",
    "businessRule": "사원번호·비밀번호로 로그인. 부서·직급·역할과 연결",
    "relatedTerms": [
      "부서",
      "직급",
      "역할"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-033",
    "section": "권한·조직",
    "kind": "엔티티",
    "name": "부서",
    "englishName": "Department",
    "abbreviation": null,
    "variableName": "department",
    "definition": "사원이 소속된 조직 단위",
    "businessRule": "상위 부서로 계층 구성. 부서장 1명. 부서 알림 대상·메신저 멤버 선택에 사용",
    "relatedTerms": [
      "부서장",
      "사원"
    ],
    "forbiddenSynonyms": [
      "팀(조직 단위 의미로)"
    ]
  },
  {
    "id": "TRM-034",
    "section": "권한·조직",
    "kind": "속성",
    "name": "부서장",
    "englishName": "Department Head",
    "abbreviation": null,
    "variableName": "headEmployeeId",
    "definition": "부서별로 지정한 책임자 1명",
    "businessRule": "소속 부서원이 요청한 구매요청의 최종 승인권자. 역할이 아님",
    "relatedTerms": [
      "부서",
      "승인권자"
    ],
    "forbiddenSynonyms": [
      "팀장"
    ]
  },
  {
    "id": "TRM-035",
    "section": "권한·조직",
    "kind": "개념",
    "name": "승인권자",
    "englishName": "Approver",
    "abbreviation": null,
    "variableName": "approverId",
    "definition": "구매요청을 최종 승인할 수 있는 사람",
    "businessRule": "요청자 소속 부서의 부서장. 승인 권한 코드 없이 부서장 지정 여부로 판단",
    "relatedTerms": [
      "부서장",
      "구매요청",
      "대응 후보"
    ],
    "forbiddenSynonyms": [
      "승인 권한자",
      "팀장"
    ]
  },
  {
    "id": "TRM-036",
    "section": "권한·조직",
    "kind": "엔티티",
    "name": "직급",
    "englishName": "Job Grade",
    "abbreviation": null,
    "variableName": "jobGrade / jobGradeId",
    "definition": "사원의 직위 등급",
    "businessRule": "관리자가 등록·수정. 표시 순서 보유",
    "relatedTerms": [
      "사원"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-037",
    "section": "권한·조직",
    "kind": "엔티티",
    "name": "역할",
    "englishName": "Role",
    "abbreviation": null,
    "variableName": "role",
    "definition": "메뉴·기능 접근 범위를 묶은 권한 단위",
    "businessRule": "사원당 1개. 영업·구매·생산·품질·물류·관리자 6개. 권한은 사용·조회. 부서장은 역할이 아님. AI 어시스턴트 추천 질문도 역할별",
    "relatedTerms": [
      "사원",
      "승인권자"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-111",
    "section": "권한·조직",
    "kind": "속성",
    "name": "권한",
    "englishName": "Permission",
    "abbreviation": null,
    "variableName": "permission",
    "definition": "역할별로 기능을 쓸 수 있는 범위",
    "businessRule": "사용(USE) / 조회(VIEW). 관리자가 변경 가능. 승인 권한은 없음(부서장 지정으로 판단)",
    "relatedTerms": [
      "역할",
      "승인권자"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-038",
    "section": "영업·수주",
    "kind": "엔티티",
    "name": "수주",
    "englishName": "Sales Order",
    "abbreviation": "SO",
    "variableName": "salesOrder / salesOrderNo",
    "definition": "고객사의 규격·수량·납기 주문",
    "businessRule": "1건에 코일·슬래브 품목 혼합 가능. 헤더 상태는 품목 상태에서 계산",
    "relatedTerms": [
      "수주 품목",
      "고객사"
    ],
    "forbiddenSynonyms": [
      "주문",
      "오더"
    ]
  },
  {
    "id": "TRM-039",
    "section": "영업·수주",
    "kind": "엔티티",
    "name": "수주 품목",
    "englishName": "Sales Order Item",
    "abbreviation": null,
    "variableName": "salesOrderItem",
    "definition": "수주 안의 규격·수량 한 행",
    "businessRule": "수량은 매수로 입력. 톤은 매수 × 1매 이론중량 계산값(저장 안 함). 예약·생산계획·라우팅·출하는 품목 단위",
    "relatedTerms": [
      "수주",
      "제품 규격",
      "부족 매수"
    ],
    "forbiddenSynonyms": [
      "주문 품목"
    ]
  },
  {
    "id": "TRM-040",
    "section": "영업·수주",
    "kind": "행위",
    "name": "재고 우선 예약",
    "englishName": "Stock-first Reservation",
    "abbreviation": null,
    "variableName": null,
    "definition": "수주 등록 시 합격·가용 재고를 먼저 예약하고 부족 매수만 생산으로 넘기는 처리",
    "businessRule": "부분 예약 허용. 코일·슬래브 모두 적용",
    "relatedTerms": [
      "예약",
      "부족 매수",
      "생산계획"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-041",
    "section": "영업·수주",
    "kind": "속성",
    "name": "부족 매수",
    "englishName": "Shortage Quantity",
    "abbreviation": null,
    "variableName": "shortageQty",
    "definition": "수주 품목 매수 중 재고로 예약하지 못한 매수",
    "businessRule": "생산계획·히트 편성의 기준 수량",
    "relatedTerms": [
      "재고 우선 예약",
      "생산계획"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-042",
    "section": "영업·수주",
    "kind": "개념",
    "name": "수주 충족 현황",
    "englishName": "Order Fulfillment Status",
    "abbreviation": null,
    "variableName": null,
    "definition": "수주 품목별 예약·생산중·검사합격·출하 매수와 진행률",
    "businessRule": "수주 품목 단위로 조회",
    "relatedTerms": [
      "수주 품목"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-043",
    "section": "영업·수주",
    "kind": "상태",
    "name": "부분 출하",
    "englishName": "Partial Shipment",
    "abbreviation": null,
    "variableName": null,
    "definition": "수주 품목 일부만 출하된 상태",
    "businessRule": "수주 헤더 상태(부분출하, 출하완료 등)는 품목 상태로 계산. 값은 공통코드",
    "relatedTerms": [
      "수주",
      "출고 확정"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-044",
    "section": "영업·수주",
    "kind": "행위",
    "name": "수주 취소",
    "englishName": "Sales Order Cancellation",
    "abbreviation": null,
    "variableName": "cancelSalesOrder",
    "definition": "수주 이행을 중단하는 처리",
    "businessRule": "예약은 RELEASED로 해제, 생산 중 물량은 여재로 전환",
    "relatedTerms": [
      "예약 상태",
      "여재"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-045",
    "section": "생산·MRP",
    "kind": "엔티티",
    "name": "생산계획",
    "englishName": "Production Plan",
    "abbreviation": null,
    "variableName": "productionPlan",
    "definition": "수주 품목의 부족 매수를 생산하기 위한 계획",
    "businessRule": "수주 품목과 연결. 수주에 연결된 생산계획은 다른 수주의 입고예정에서 제외",
    "relatedTerms": [
      "부족 매수",
      "히트 편성",
      "재생산"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-046",
    "section": "생산·MRP",
    "kind": "행위",
    "name": "히트 편성",
    "englishName": "Heat Planning (업계 용어 Charge Planning)",
    "abbreviation": null,
    "variableName": "planHeats",
    "definition": "필요 용강량을 히트 용량 단위로 나눠 히트 수를 정하는 작업",
    "businessRule": "수주 품목(강종) 기준. 히트 수 = ceil(필요 용강량 ÷ 히트 용량)",
    "relatedTerms": [
      "히트",
      "히트 용량",
      "누적 계획수율"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-047",
    "section": "생산·MRP",
    "kind": "엔티티",
    "name": "작업 실적",
    "englishName": "Production Result",
    "abbreviation": null,
    "variableName": "productionResult",
    "definition": "공정별 작업 시작·완료와 산출 기록",
    "businessRule": "제선 = 용선, 제강 = 히트, 연주 = 슬래브, 열연 = 코일",
    "relatedTerms": [
      "제선",
      "제강",
      "연주",
      "열연"
    ],
    "forbiddenSynonyms": [
      "생산 실적",
      "공정 실적"
    ]
  },
  {
    "id": "TRM-048",
    "section": "생산·MRP",
    "kind": "상태",
    "name": "여재",
    "englishName": "Surplus Slab",
    "abbreviation": null,
    "variableName": null,
    "definition": "수주에 쓰이지 않고 남은 미배정 합격 슬래브",
    "businessRule": "슬래브 단계로 고정. 가용재고에 포함. 수주 취소 시 생산 중 물량도 여재로 전환",
    "relatedTerms": [
      "가용재고",
      "슬래브",
      "배정"
    ],
    "forbiddenSynonyms": [
      "잔재",
      "잉여재고"
    ]
  },
  {
    "id": "TRM-049",
    "section": "생산·MRP",
    "kind": "행위",
    "name": "MRP",
    "englishName": "Material Requirements Planning",
    "abbreviation": "MRP",
    "variableName": null,
    "definition": "수주에서 라우팅 수율을 역산해 필요 용선과 원료·합금철 소요량을 계산하는 기능",
    "businessRule": "원료 잔량·입고예정 차감. 여재는 가용재고에 포함. 원료 안전재고 없음",
    "relatedTerms": [
      "소요량",
      "입고예정",
      "배합 원단위"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-050",
    "section": "생산·MRP",
    "kind": "속성",
    "name": "소요량",
    "englishName": "Required Quantity",
    "abbreviation": null,
    "variableName": "requiredTon",
    "definition": "MRP로 계산한 원료·합금철 필요량",
    "businessRule": "톤 단위(소수 3자리). 합금철 = 용강(히트) 톤 × 원단위(kg/톤) ÷ 1,000",
    "relatedTerms": [
      "MRP"
    ],
    "forbiddenSynonyms": [
      "필요량"
    ]
  },
  {
    "id": "TRM-051",
    "section": "생산·MRP",
    "kind": "속성",
    "name": "입고예정",
    "englishName": "Scheduled Receipt",
    "abbreviation": null,
    "variableName": "scheduledReceiptTon",
    "definition": "발주됐지만 아직 입고되지 않은 수량",
    "businessRule": "MRP·Agent에서 원료 잔량과 함께 차감",
    "relatedTerms": [
      "발주",
      "입고"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-052",
    "section": "생산·MRP",
    "kind": "행위",
    "name": "재생산",
    "englishName": "Reproduction",
    "abbreviation": null,
    "variableName": null,
    "definition": "합격 매수가 수주 대비 부족할 때 부족 매수만큼 다시 생산하는 계획",
    "businessRule": "담당자가 등록(P1). 자동 초안은 Agent(P2)",
    "relatedTerms": [
      "생산계획",
      "합격"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-053",
    "section": "생산·MRP",
    "kind": "개념",
    "name": "실적 시뮬레이션",
    "englishName": "Result Simulation",
    "abbreviation": null,
    "variableName": null,
    "definition": "생산계획 기준으로 공정별 실적을 가정값으로 생성하는 기능",
    "businessRule": "시드·시연용. 화면에서 생산계획을 선택해 실행. 계획 수율 고정, 0~5% 랜덤 손실을 연주 슬래브 매수 감소로 반영, 열연 수율 고정",
    "relatedTerms": [
      "시드 데이터",
      "계획 수율"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-054",
    "section": "재고·예약·배정",
    "kind": "엔티티",
    "name": "재고",
    "englishName": "Inventory",
    "abbreviation": null,
    "variableName": "inventory",
    "definition": "품목별 보유 수량",
    "businessRule": "제품은 매수(톤은 계산값), 원료는 톤(소수). 제품은 예약 매수를 함께 관리. 원료 재고는 원료 LOT 잔량 합계로 계산(재고 행 없음)",
    "relatedTerms": [
      "가용재고",
      "예약 매수"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-055",
    "section": "재고·예약·배정",
    "kind": "속성",
    "name": "가용재고",
    "englishName": "Available Stock",
    "abbreviation": null,
    "variableName": "availableQty",
    "definition": "새로 예약·배정할 수 있는 합격 재고",
    "businessRule": "합격 재고 중 미예약분. 여재 포함. 불합격 LOT·불합격 히트의 하위 LOT 제외",
    "relatedTerms": [
      "합격",
      "여재",
      "예약"
    ],
    "forbiddenSynonyms": [
      "가용 재고",
      "가용량"
    ]
  },
  {
    "id": "TRM-056",
    "section": "재고·예약·배정",
    "kind": "엔티티",
    "name": "예약",
    "englishName": "Reservation",
    "abbreviation": null,
    "variableName": "reservation",
    "definition": "수주 품목을 위해 합격 재고의 매수를 확보하는 것",
    "businessRule": "매수 단위. 부분 예약 허용. 만료 없음. 배정과 분리",
    "relatedTerms": [
      "배정",
      "예약 상태",
      "예약 매수"
    ],
    "forbiddenSynonyms": [
      "할당",
      "선점",
      "Allocation"
    ]
  },
  {
    "id": "TRM-057",
    "section": "재고·예약·배정",
    "kind": "상태",
    "name": "예약 상태",
    "englishName": "Reservation Status",
    "abbreviation": null,
    "variableName": "reservationStatus",
    "definition": "예약의 현재 상태",
    "businessRule": "ACTIVE 유효 / CONVERTED 출고 확정으로 전환 / RELEASED 수주 취소로 해제",
    "relatedTerms": [
      "예약"
    ],
    "forbiddenSynonyms": [
      "RESERVED",
      "SHIPPED"
    ]
  },
  {
    "id": "TRM-058",
    "section": "재고·예약·배정",
    "kind": "속성",
    "name": "예약 매수",
    "englishName": "Reserved Quantity",
    "abbreviation": null,
    "variableName": "reservedQty",
    "definition": "제품 재고 중 수주에 예약된 매수",
    "businessRule": "매수 단위. 예약과 같은 트랜잭션에서 갱신",
    "relatedTerms": [
      "예약",
      "가용재고"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-059",
    "section": "재고·예약·배정",
    "kind": "행위",
    "name": "자동 예약",
    "englishName": "Auto Reservation",
    "abbreviation": null,
    "variableName": null,
    "definition": "부족분 생산분이 검사에 합격하면 원래 수주 품목에 자동으로 예약하는 처리",
    "businessRule": "SYSTEM 이벤트로 기록",
    "relatedTerms": [
      "예약",
      "합격"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-060",
    "section": "재고·예약·배정",
    "kind": "엔티티",
    "name": "배정",
    "englishName": "Allocation",
    "abbreviation": null,
    "variableName": "allocation",
    "definition": "출하요청·열연 투입에 쓸 합격 LOT을 지정하는 것",
    "businessRule": "강종·규격이 일치하는 합격 LOT을 FIFO로 추천하고 담당자가 확정. 변경 허용. 예약과 분리. 확정 시 생성, 상태 CONFIRMED / CONSUMED(출고 확정·열연 투입) / RELEASED(변경·취소). 추천은 작업 로그로만 기록. 배정 대기는 출하요청 품목의 미배정 상태",
    "relatedTerms": [
      "예약",
      "FIFO",
      "출하요청"
    ],
    "forbiddenSynonyms": [
      "할당"
    ]
  },
  {
    "id": "TRM-061",
    "section": "재고·예약·배정",
    "kind": "개념",
    "name": "FIFO",
    "englishName": "First In, First Out",
    "abbreviation": "FIFO",
    "variableName": null,
    "definition": "먼저 생산 완료된 제품부터 추천하는 규칙",
    "businessRule": "기준일은 출하 제품의 생산완료일",
    "relatedTerms": [
      "배정"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-062",
    "section": "재고·예약·배정",
    "kind": "행위",
    "name": "정합성 보정",
    "englishName": "Reservation Reconciliation",
    "abbreviation": null,
    "variableName": null,
    "definition": "예약 매수 합계와 재고의 예약 매수를 비교해 바로잡는 처리",
    "businessRule": "주기 실행. P2",
    "relatedTerms": [
      "예약 매수"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-063",
    "section": "구매",
    "kind": "엔티티",
    "name": "구매요청",
    "englishName": "Purchase Requisition",
    "abbreviation": null,
    "variableName": "purchaseRequisition",
    "definition": "원료 구매 필요를 내부 승인받기 위한 요청",
    "businessRule": "담당자가 MRP를 참고해 등록하거나 메시지 초안 확정으로 생성. 부서장 승인 후 발주",
    "relatedTerms": [
      "발주",
      "승인권자",
      "Action Draft"
    ],
    "forbiddenSynonyms": [
      "구매 요청"
    ]
  },
  {
    "id": "TRM-064",
    "section": "구매",
    "kind": "엔티티",
    "name": "발주",
    "englishName": "Purchase Order",
    "abbreviation": "PO",
    "variableName": "purchaseOrder",
    "definition": "승인된 구매요청을 공급업체에 주문으로 확정한 것",
    "businessRule": "공급업체 1곳당 1건으로 여러 품목을 묶음",
    "relatedTerms": [
      "구매요청",
      "입고",
      "공급업체"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-065",
    "section": "구매",
    "kind": "엔티티",
    "name": "입고",
    "englishName": "Goods Receipt",
    "abbreviation": null,
    "variableName": "goodsReceipt",
    "definition": "발주한 원료를 받아 재고로 확정하는 것",
    "businessRule": "부분 입고 허용. 입고 확정 시 원료 LOT 생성. 입고 검사 없음",
    "relatedTerms": [
      "발주",
      "원료 LOT",
      "입고예정"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-066",
    "section": "구매",
    "kind": "개념",
    "name": "조달 자동화",
    "englishName": "Procurement Automation",
    "abbreviation": null,
    "variableName": null,
    "definition": "원료 부족이 예상되면 구매요청 초안을 자동 생성하는 Agent 규칙",
    "businessRule": "P2. 초안은 사람이 확인·승인",
    "relatedTerms": [
      "AI Factory Agent",
      "구매요청"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-067",
    "section": "LOT 추적",
    "kind": "엔티티",
    "name": "LOT",
    "englishName": "Lot",
    "abbreviation": null,
    "variableName": "lot / lotNo",
    "definition": "원료·용선·히트·슬래브·코일을 추적하는 식별 단위",
    "businessRule": "계층: 원료 → 용선 → 히트 → 슬래브 → 코일. 합금철은 히트에 직접 연결",
    "relatedTerms": [
      "LOT 관계",
      "LOT 채번"
    ],
    "forbiddenSynonyms": [
      "로트"
    ]
  },
  {
    "id": "TRM-068",
    "section": "LOT 추적",
    "kind": "엔티티",
    "name": "LOT 관계",
    "englishName": "Lot Relation",
    "abbreviation": null,
    "variableName": "lotRelation",
    "definition": "상위 LOT의 투입과 하위 LOT의 산출을 잇는 연결",
    "businessRule": "원료→용선 기간 기반(FIFO 차감된 LOT만), 용선→히트 N:M(FIFO 자동 투입), 히트→슬래브 1:N, 슬래브→코일 1:1. 합금철 → 히트는 실제 투입",
    "relatedTerms": [
      "LOT",
      "역추적",
      "정추적"
    ],
    "forbiddenSynonyms": [
      "LOT 계보",
      "LOT 계층"
    ]
  },
  {
    "id": "TRM-069",
    "section": "LOT 추적",
    "kind": "개념",
    "name": "LOT 채번",
    "englishName": "Lot Numbering",
    "abbreviation": null,
    "variableName": null,
    "definition": "LOT 유형별 번호 부여 규칙",
    "businessRule": "원료 RM-원료코드-YYMMDD-NNN / 용선 HM-고로-YYMMDD-NN / 히트 HT-전로-YYMMDD-NNN / 슬래브 히트번호-SS / 코일 C + 슬래브번호(HT- 제외)",
    "relatedTerms": [
      "LOT"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-070",
    "section": "LOT 추적",
    "kind": "엔티티",
    "name": "원료 LOT",
    "englishName": "Raw Material Lot",
    "abbreviation": "RM",
    "variableName": null,
    "definition": "입고 확정 시 생성하는 원료 추적 단위",
    "businessRule": "잔량(톤) 관리. 제선(철광석·석탄·석회석)·제강(합금철) 실적 시 입고일 순(FIFO)으로 차감",
    "relatedTerms": [
      "원료",
      "입고",
      "원료·용선 LOT 잔량"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-071",
    "section": "LOT 추적",
    "kind": "속성",
    "name": "원료·용선 LOT 잔량",
    "englishName": "Remaining Quantity",
    "abbreviation": null,
    "variableName": "remainingTon",
    "definition": "원료·용선 LOT에 남은 톤",
    "businessRule": "투입 시 차감(원료는 제선·제강, 용선은 제강)",
    "relatedTerms": [
      "원료 LOT",
      "MRP"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-072",
    "section": "LOT 추적",
    "kind": "행위",
    "name": "역추적",
    "englishName": "Backward Trace",
    "abbreviation": null,
    "variableName": null,
    "definition": "코일에서 슬래브·히트·용선·원료까지 거슬러 조회하는 것",
    "businessRule": "품질 문의·밀시트 근거 확인에 사용",
    "relatedTerms": [
      "정추적",
      "LOT 관계"
    ],
    "forbiddenSynonyms": [
      "역방향 추적"
    ]
  },
  {
    "id": "TRM-073",
    "section": "LOT 추적",
    "kind": "행위",
    "name": "정추적",
    "englishName": "Forward Trace",
    "abbreviation": null,
    "variableName": null,
    "definition": "원료·히트에서 영향받은 슬래브·코일·출하를 조회하는 것",
    "businessRule": "불합격 영향 범위 확인에 사용",
    "relatedTerms": [
      "역추적",
      "LOT 관계"
    ],
    "forbiddenSynonyms": [
      "정방향 추적"
    ]
  },
  {
    "id": "TRM-074",
    "section": "품질",
    "kind": "엔티티",
    "name": "품질검사",
    "englishName": "Quality Inspection",
    "abbreviation": null,
    "variableName": "qualityInspection",
    "definition": "공정별 측정값을 입력하는 검사",
    "businessRule": "제강: 히트 성분 / 연주: 슬래브 표면·치수 / 열연: 코일 치수·기계적 성질. LOT당 1건(lot_id unique), 항목별 측정값은 검사 측정값에 저장",
    "relatedTerms": [
      "검사 항목",
      "자동 판정"
    ],
    "forbiddenSynonyms": [
      "공정별 검사"
    ]
  },
  {
    "id": "TRM-075",
    "section": "품질",
    "kind": "엔티티",
    "name": "검사 항목",
    "englishName": "Inspection Item",
    "abbreviation": null,
    "variableName": "inspectionStandardItem",
    "definition": "검사 기준(버전)에 속한 측정 항목과 min/max",
    "businessRule": "제강 기준의 항목이 강종 성분 규격(TRM-020). min/max는 경계 포함(이상·이하)",
    "relatedTerms": [
      "성분 규격",
      "검사 기준",
      "검사 측정값"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-114",
    "section": "품질",
    "kind": "엔티티",
    "name": "검사 측정값",
    "englishName": "Inspection Value",
    "abbreviation": null,
    "variableName": "qualityInspectionValue",
    "definition": "품질검사의 항목별 측정값",
    "businessRule": "검사 기준 항목별 1행. 보완·오타 수정은 같은 행 수정, 변경 전·후는 작업 로그. 밀시트 발행 후 수정 불가",
    "relatedTerms": [
      "품질검사",
      "검사 항목"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-076",
    "section": "품질",
    "kind": "행위",
    "name": "자동 판정",
    "englishName": "Auto Judgment",
    "abbreviation": null,
    "variableName": null,
    "definition": "측정값을 입력하면 시스템이 min/max와 비교해 합격·불합격을 정하는 것",
    "businessRule": "시스템 판정이 곧 결과(제안 단계 없음)",
    "relatedTerms": [
      "합격",
      "불합격 LOT"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-077",
    "section": "품질",
    "kind": "상태",
    "name": "합격",
    "englishName": "Passed",
    "abbreviation": null,
    "variableName": "isPassed",
    "definition": "예약·배정할 수 있는 검사 결과",
    "businessRule": "슬래브: 히트 성분 합격 + 슬래브 검사 합격 / 코일: 상위 히트 성분 합격 + 코일 검사 합격",
    "relatedTerms": [
      "가용재고",
      "불합격 LOT"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-078",
    "section": "품질",
    "kind": "상태",
    "name": "불합격 LOT",
    "englishName": "Rejected Lot",
    "abbreviation": null,
    "variableName": null,
    "definition": "검사 기준을 충족하지 못한 LOT과 불합격 히트의 하위 LOT",
    "businessRule": "예약·배정·출고 대상에서 제외",
    "relatedTerms": [
      "불합격 상태",
      "과거 사례"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-079",
    "section": "품질",
    "kind": "상태",
    "name": "불합격 상태",
    "englishName": "Disposition Status",
    "abbreviation": null,
    "variableName": "dispositionStatus",
    "definition": "불합격 LOT의 후속 처리 상태",
    "businessRule": "보류 / 격하 / 폐기. 품질 담당이 지정·사유 기록만 하고 후속 처리 로직은 구현하지 않음. 값은 공통코드",
    "relatedTerms": [
      "불합격 LOT"
    ],
    "forbiddenSynonyms": [
      "HOLD(불합격 상태의 값 '보류'로만 사용, 별도 개념 아님)"
    ]
  },
  {
    "id": "TRM-110",
    "section": "품질",
    "kind": "엔티티",
    "name": "검사 기준",
    "englishName": "Inspection Standard",
    "abbreviation": null,
    "variableName": "inspectionStandard",
    "definition": "공정·강종별 검사 항목과 min/max를 묶은 기준서",
    "businessRule": "품질 담당이 관리. 변경 시 새 버전 생성. 검사 기록은 판정에 쓴 기준 버전을 참조. 검사 항목 시드는 KS 인증심사기준 참고. 제강 기준의 항목이 강종 성분 규격. 항목별로 적용 두께 구간을 둘 수 있음(선택, \"초과~이하\"로 판정. 샤르피 충격은 두께 6mm 초과만)",
    "relatedTerms": [
      "검사 항목",
      "성분 규격",
      "품질검사"
    ],
    "forbiddenSynonyms": [
      "검사 기준서"
    ]
  },
  {
    "id": "TRM-080",
    "section": "출하",
    "kind": "엔티티",
    "name": "출하요청",
    "englishName": "Shipment Request",
    "abbreviation": null,
    "variableName": "shipmentRequest",
    "definition": "여러 수주 품목을 묶어 출하를 요청하는 것",
    "businessRule": "요청 시 배정 추천 후 확정",
    "relatedTerms": [
      "배정",
      "출고 확정"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-115",
    "section": "출하",
    "kind": "엔티티",
    "name": "출하요청 품목",
    "englishName": "Shipment Request Item",
    "abbreviation": null,
    "variableName": "shipmentRequestItem",
    "definition": "출하요청에 묶인 수주 품목별 요청 매수",
    "businessRule": "같은 고객사 수주 품목만 묶는다. 미배정 매수(요청 매수 − 이 품목에 확정된 배정 수)가 0보다 크면 배정 대기",
    "relatedTerms": [
      "출하요청",
      "배정",
      "수주 품목"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-081",
    "section": "출하",
    "kind": "행위",
    "name": "출고 확정",
    "englishName": "Goods Issue",
    "abbreviation": null,
    "variableName": "confirmGoodsIssue",
    "definition": "출하할 LOT을 최종 확정하고 재고를 소진하는 처리",
    "businessRule": "예약을 CONVERTED로 전환. 검사 미합격 LOT 차단. 밀시트 자동 생성",
    "relatedTerms": [
      "출하요청",
      "밀시트",
      "예약 상태"
    ],
    "forbiddenSynonyms": [
      "출하 확정"
    ]
  },
  {
    "id": "TRM-082",
    "section": "출하",
    "kind": "엔티티",
    "name": "밀시트",
    "englishName": "Mill Sheet (국제 명칭 Mill Test Certificate, MTC)",
    "abbreviation": null,
    "variableName": "millSheet",
    "definition": "출하 제품의 히트 성분과 슬래브·코일 검사값을 담은 품질 증명 문서",
    "businessRule": "출고 확정 시 자동 생성. 발행 시점 값을 스냅샷으로 저장. 화면 조회·PDF 출력. PDF는 버튼 클릭 시 생성해 Storage에 저장하고 경로를 보관",
    "relatedTerms": [
      "스냅샷",
      "출고 확정"
    ],
    "forbiddenSynonyms": [
      "성적서"
    ]
  },
  {
    "id": "TRM-083",
    "section": "출하",
    "kind": "개념",
    "name": "스냅샷",
    "englishName": "Snapshot",
    "abbreviation": null,
    "variableName": null,
    "definition": "발행 시점의 값을 고정해 저장한 사본",
    "businessRule": "이후 원본이 바뀌어도 밀시트 값은 유지",
    "relatedTerms": [
      "밀시트"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-084",
    "section": "작업 로그·업무·알림",
    "kind": "엔티티",
    "name": "작업 로그",
    "englishName": "Business Event",
    "abbreviation": null,
    "variableName": "businessEvent",
    "definition": "사용자·시스템이 한 업무 처리와 판단을 기록한 이력",
    "businessRule": "이벤트마다 주체, 대상, 변경 전·후 데이터 기록. 기록 대상은 LOG-002",
    "relatedTerms": [
      "주체 구분",
      "이력 재현"
    ],
    "forbiddenSynonyms": [
      "감사 로그",
      "감사 이력",
      "비즈니스 이벤트"
    ]
  },
  {
    "id": "TRM-116",
    "section": "작업 로그·업무·알림",
    "kind": "엔티티",
    "name": "작업 로그 LOT 연결",
    "englishName": "Business Event LOT",
    "abbreviation": null,
    "variableName": "businessEventLot",
    "definition": "작업 로그 1건과 관련 LOT을 잇는 연결",
    "businessRule": "이벤트 1건에 LOT 여러 개를 연결할 수 있다(출고 확정 등). LOT 타임라인은 이 연결로 조회한다",
    "relatedTerms": [
      "작업 로그",
      "LOT",
      "LOT 타임라인"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-085",
    "section": "작업 로그·업무·알림",
    "kind": "속성",
    "name": "주체 구분",
    "englishName": "Actor Type",
    "abbreviation": null,
    "variableName": "actorType",
    "definition": "이벤트를 발생시킨 주체",
    "businessRule": "USER / SYSTEM. 값은 공통코드",
    "relatedTerms": [
      "작업 로그"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-086",
    "section": "작업 로그·업무·알림",
    "kind": "개념",
    "name": "이력 재현",
    "englishName": "Decision Replay",
    "abbreviation": null,
    "variableName": null,
    "definition": "수주·LOT 단위 이벤트를 시간순 타임라인으로 보는 조회",
    "businessRule": "배정·재생산·승인 근거 확인",
    "relatedTerms": [
      "작업 로그"
    ],
    "forbiddenSynonyms": [
      "결정 재현"
    ]
  },
  {
    "id": "TRM-087",
    "section": "작업 로그·업무·알림",
    "kind": "엔티티",
    "name": "업무",
    "englishName": "Task",
    "abbreviation": null,
    "variableName": "task",
    "definition": "담당자와 마감일이 있는 실행 항목",
    "businessRule": "회의록에서 뽑은 할 일도 업무로 등록",
    "relatedTerms": [
      "알림"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-117",
    "section": "작업 로그·업무·알림",
    "kind": "속성",
    "name": "등록자",
    "englishName": "Creator",
    "abbreviation": null,
    "variableName": "creatorId",
    "definition": "업무를 등록한 사원",
    "businessRule": "등록자와 담당자만 업무를 고칠 수 있다. 업무 목록은 내가 담당하거나 등록한 업무로 거른다",
    "relatedTerms": [
      "업무",
      "담당자"
    ],
    "forbiddenSynonyms": [
      "작성자",
      "요청자"
    ]
  },
  {
    "id": "TRM-088",
    "section": "작업 로그·업무·알림",
    "kind": "엔티티",
    "name": "알림",
    "englishName": "Notification",
    "abbreviation": null,
    "variableName": "notification",
    "definition": "개인·부서에 보내는 업무·상태 알림",
    "businessRule": "메신저·Agent 알림도 같은 모듈 사용",
    "relatedTerms": [
      "업무",
      "부서"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-089",
    "section": "협업·AI",
    "kind": "개념",
    "name": "업무형 메신저",
    "englishName": "Work Messenger",
    "abbreviation": null,
    "variableName": null,
    "definition": "ERP 업무와 연결되는 사내 메신저",
    "businessRule": "1:1·그룹·업무방, 실시간 송수신, 파일 첨부, 안 읽은 수 표시",
    "relatedTerms": [
      "채팅방",
      "업무방"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-090",
    "section": "협업·AI",
    "kind": "엔티티",
    "name": "채팅방",
    "englishName": "Chat Room",
    "abbreviation": null,
    "variableName": "chatRoom",
    "definition": "메시지를 주고받는 방",
    "businessRule": "유형: 1:1, 그룹, 업무방. 멤버는 조직 정보에서 선택",
    "relatedTerms": [
      "업무방"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-091",
    "section": "협업·AI",
    "kind": "개념",
    "name": "업무방",
    "englishName": "Work Room",
    "abbreviation": null,
    "variableName": null,
    "definition": "수주에 연결된 채팅방",
    "businessRule": "상단에 수주 정보 표시. 연결된 ERP 화면으로 이동",
    "relatedTerms": [
      "채팅방",
      "수주"
    ],
    "forbiddenSynonyms": [
      "수주별 채팅방"
    ]
  },
  {
    "id": "TRM-092",
    "section": "협업·AI",
    "kind": "개념",
    "name": "Message → ERP",
    "englishName": "Message to ERP",
    "abbreviation": null,
    "variableName": null,
    "definition": "메시지에서 값을 추출해 업무 초안을 만들고, 사용자가 확정하면 ERP 데이터를 만드는 흐름",
    "businessRule": "P1은 구매요청 1종, 확장 유형은 P2",
    "relatedTerms": [
      "Action Draft",
      "실행 핸들러"
    ],
    "forbiddenSynonyms": [
      "대화 → ERP"
    ]
  },
  {
    "id": "TRM-093",
    "section": "협업·AI",
    "kind": "엔티티",
    "name": "Action Draft",
    "englishName": "Action Draft",
    "abbreviation": null,
    "variableName": "actionDraft",
    "definition": "AI나 규칙이 만든, 아직 실행되지 않은 업무 초안",
    "businessRule": "원본(메시지 등)을 연결해 저장. 상태 흐름은 초안 상태 참고",
    "relatedTerms": [
      "초안 상태",
      "실행 카드",
      "대응 후보"
    ],
    "forbiddenSynonyms": [
      "실행 초안",
      "ERP 거래 초안"
    ]
  },
  {
    "id": "TRM-094",
    "section": "협업·AI",
    "kind": "상태",
    "name": "초안 상태",
    "englishName": "Draft Status",
    "abbreviation": null,
    "variableName": "draftStatus",
    "definition": "Action Draft의 진행 상태",
    "businessRule": "AI_GENERATED → WAITING_APPROVAL → APPROVED → EXECUTED, 반려 시 REJECTED. 모든 초안 유형 공통이고 확정 주체만 다름(구매요청 초안: 요청자 / 실행 카드: 사용자 / Agent 대응 후보: 담당 부서원)",
    "relatedTerms": [
      "Action Draft"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-095",
    "section": "협업·AI",
    "kind": "개념",
    "name": "추출 스키마",
    "englishName": "Extraction Schema",
    "abbreviation": null,
    "variableName": null,
    "definition": "업무 유형별로 메시지에서 뽑을 항목 정의",
    "businessRule": "구매요청: 원료 품목, 수량(톤), 희망 입고일, 요청자",
    "relatedTerms": [
      "실행 핸들러"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-096",
    "section": "협업·AI",
    "kind": "개념",
    "name": "실행 핸들러",
    "englishName": "Execution Handler",
    "abbreviation": null,
    "variableName": null,
    "definition": "확정된 초안을 해당 ERP 기능으로 실행하는 모듈",
    "businessRule": "업무 유형별로 등록. 해당 모듈 담당자가 구현",
    "relatedTerms": [
      "추출 스키마"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-097",
    "section": "협업·AI",
    "kind": "개념",
    "name": "Voice2ERP",
    "englishName": "Voice to ERP",
    "abbreviation": null,
    "variableName": null,
    "definition": "회의 음성을 텍스트로 바꿔 회의록·할 일·구매요청 초안으로 연결하는 기능",
    "businessRule": "P2. 사용자 확인 후 등록",
    "relatedTerms": [
      "STT",
      "회의록"
    ],
    "forbiddenSynonyms": [
      "회의 → 업무"
    ]
  },
  {
    "id": "TRM-098",
    "section": "협업·AI",
    "kind": "개념",
    "name": "STT",
    "englishName": "Speech to Text",
    "abbreviation": "STT",
    "variableName": null,
    "definition": "음성을 텍스트로 바꾸는 기술",
    "businessRule": "API 선택·비용은 미결정",
    "relatedTerms": [
      "Voice2ERP"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-099",
    "section": "협업·AI",
    "kind": "엔티티",
    "name": "회의록",
    "englishName": "Meeting Minutes",
    "abbreviation": null,
    "variableName": "meetingMinutes",
    "definition": "회의 날짜·참석자·전체 기록",
    "businessRule": "AI가 요약·결정사항·할 일을 추출",
    "relatedTerms": [
      "Voice2ERP",
      "업무"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-100",
    "section": "협업·AI",
    "kind": "개념",
    "name": "AI 어시스턴트",
    "englishName": "AI Assistant",
    "abbreviation": null,
    "variableName": null,
    "definition": "모든 화면 오른쪽 패널과 사내 채팅 @AI로 부르는 1:1 업무 도우미",
    "businessRule": "업무 지식·데이터 조회·업무 초안·과거 사례 검색. 조회와 초안만 하고 데이터는 직접 바꾸지 않음. 숫자는 DB 조회 결과로만 답함",
    "relatedTerms": [
      "실행 카드",
      "업무 매뉴얼"
    ],
    "forbiddenSynonyms": [
      "@ERP Assistant",
      "ERP Assistant",
      "챗봇"
    ]
  },
  {
    "id": "TRM-101",
    "section": "협업·AI",
    "kind": "개념",
    "name": "실행 카드",
    "englishName": "Action Card",
    "abbreviation": null,
    "variableName": null,
    "definition": "AI 어시스턴트가 Action Draft를 보여주고 확정받는 카드",
    "businessRule": "사용자가 확정하면 사용자 권한으로 ERP가 실행. 예: 배정 추천, 히트 편성안, 수주 등록 초안",
    "relatedTerms": [
      "Action Draft",
      "AI 경유"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-102",
    "section": "협업·AI",
    "kind": "개념",
    "name": "업무 매뉴얼",
    "englishName": "Work Manual",
    "abbreviation": null,
    "variableName": null,
    "definition": "역할별 업무 절차 문서",
    "businessRule": "AI 어시스턴트 업무 지식의 근거. 작성 담당·개수는 미결정",
    "relatedTerms": [
      "AI 어시스턴트"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-103",
    "section": "협업·AI",
    "kind": "속성",
    "name": "AI 경유",
    "englishName": "AI-assisted",
    "abbreviation": null,
    "variableName": "isAiAssisted",
    "definition": "AI 초안으로 확정한 작업인지 여부",
    "businessRule": "작업 로그에 표시",
    "relatedTerms": [
      "작업 로그",
      "실행 카드"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-104",
    "section": "협업·AI",
    "kind": "개념",
    "name": "AI Factory Agent",
    "englishName": "AI Factory Agent",
    "abbreviation": null,
    "variableName": null,
    "definition": "규칙으로 위험을 감지하고 대응 후보를 만드는 기능",
    "businessRule": "AI는 상황 설명만. 대응 후보는 개별 승인 후 실행. P2",
    "relatedTerms": [
      "감지 트리거",
      "대응 후보"
    ],
    "forbiddenSynonyms": [
      "Factory Agent"
    ]
  },
  {
    "id": "TRM-105",
    "section": "협업·AI",
    "kind": "개념",
    "name": "감지 트리거",
    "englishName": "Detection Trigger",
    "abbreviation": null,
    "variableName": null,
    "definition": "Agent가 감지를 시작하는 조건",
    "businessRule": "스케줄: 원료 부족, 납기 위험, 여재 장기 보유, 불합격률 상승 / 이벤트: 검사 결과 등록 시 합격 매수 부족",
    "relatedTerms": [
      "AI Factory Agent"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-106",
    "section": "협업·AI",
    "kind": "개념",
    "name": "대응 후보",
    "englishName": "Response Candidate",
    "abbreviation": null,
    "variableName": null,
    "definition": "Agent가 규칙으로 만든 대응안",
    "businessRule": "Action Draft로 저장. 같은 대상의 미처리 초안이 있으면 새로 만들지 않음. 담당 부서원이 개별 확정(확정자가 요청자). 구매요청이면 요청자 소속 부서장이 최종 승인",
    "relatedTerms": [
      "Action Draft",
      "승인권자",
      "역할"
    ],
    "forbiddenSynonyms": [
      "대응안"
    ]
  },
  {
    "id": "TRM-107",
    "section": "협업·AI",
    "kind": "개념",
    "name": "납기 위험",
    "englishName": "Delivery Risk",
    "abbreviation": null,
    "variableName": null,
    "definition": "납기 안에 출하하지 못할 가능성",
    "businessRule": "납기일까지 남은 일수가 기준일(설정값, 초기 3일) 이하이고 출하 매수가 수주 매수보다 적으면 위험. 납기 검증(Promise Engine)은 범위 제외",
    "relatedTerms": [
      "AI Factory Agent"
    ],
    "forbiddenSynonyms": []
  },
  {
    "id": "TRM-108",
    "section": "협업·AI",
    "kind": "엔티티",
    "name": "과거 사례",
    "englishName": "Past Case",
    "abbreviation": null,
    "variableName": "pastCase",
    "definition": "불합격 처리 후 현상·원인·조치를 기록한 사례",
    "businessRule": "구분(품질/설비). 관련 설비는 텍스트, 관련 LOT 연결. AI 초안 후 품질 담당이 저장. 한국어 전문검색(ngram) + AI 요약. EX",
    "relatedTerms": [
      "불합격 LOT",
      "AI 어시스턴트"
    ],
    "forbiddenSynonyms": [
      "품질 사례 DB",
      "Company Memory"
    ]
  },
  {
    "id": "TRM-109",
    "section": "협업·AI",
    "kind": "개념",
    "name": "대시보드 위젯",
    "englishName": "Dashboard Widget",
    "abbreviation": null,
    "variableName": null,
    "definition": "대시보드를 구성하는 현황 표시 단위",
    "businessRule": "기본 6개, 추가·제외 가능. P3",
    "relatedTerms": [],
    "forbiddenSynonyms": []
  }
];
