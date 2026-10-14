// 이 파일은 scripts/generate-glossary.mjs가 업무 프로세스 정의서(docs/notion/04-업무-프로세스-정의서.md) 6.0 표에서 만든다. 손으로 고치지 않는다.
// 바꾸는 순서: 업무 프로세스 정의서 수정 → npm run glossary -w @fantasteel/server
import type { ProcessStep } from './process.types';

export const PROCESS_STEPS: readonly ProcessStep[] = [
  {
    "id": "BP-AUTH-01",
    "name": "로그인·조직·권한",
    "actor": "사원·관리자",
    "flow": "계정 확인 → 인증 → 역할·범위 조회 → API마다 권한 재확인",
    "output": "세션, 접근 범위, 부서 계층, 승인권자"
  },
  {
    "id": "BP-MST-01",
    "name": "기준정보 준비",
    "actor": "관리자",
    "flow": "규격·매핑·라우팅·배합 입력 → 검증 → 이론중량 확정",
    "output": "계산 가능한 마스터(슬래브 12·코일 12)"
  },
  {
    "id": "BP-SO-01",
    "name": "수주 등록·예약·계획",
    "actor": "영업",
    "flow": "정수 수량 입력 → 톤 표시 → 합격 재고 우선 예약 → 부족분만 생산계획",
    "output": "수주, ACTIVE 예약, 생산계획"
  },
  {
    "id": "BP-SO-02",
    "name": "부분 출하·수주 취소",
    "actor": "영업",
    "flow": "예약 RELEASED → 배정 해제 → 시작 전 계획 취소 → 진행분은 완료 후 여재",
    "output": "취소 이벤트, 여재 표시"
  },
  {
    "id": "BP-PRD-01",
    "name": "히트 편성·MRP",
    "actor": "생산·구매",
    "flow": "부족 매수 → 필요 용강량 → 히트 수 올림 → 원료 순소요",
    "output": "히트 편성표, MRP 결과"
  },
  {
    "id": "BP-PUR-01",
    "name": "구매요청·승인·발주",
    "actor": "구매·부서장",
    "flow": "요청 → 부서장 승인 → 공급업체별 발주",
    "output": "발주, 입고예정"
  },
  {
    "id": "BP-PUR-02",
    "name": "부분 입고·원료 LOT",
    "actor": "구매",
    "flow": "미입고량 확인 → 입고 확정 → 원료 LOT 생성",
    "output": "원료 LOT, 톤 잔량"
  },
  {
    "id": "BP-PRD-02",
    "name": "제선·제강·연주 실적",
    "actor": "생산",
    "flow": "공정별 실적(수동 또는 실적 시뮬레이션) → 투입 차감 → LOT·계보",
    "output": "용선·히트·슬래브 LOT"
  },
  {
    "id": "BP-QC-01",
    "name": "검사·판정·재생산",
    "actor": "품질·생산",
    "flow": "측정값 → 자동 판정 → 자동 예약 / 불합격 처리 상태 지정 → 여재 확인 후 재생산",
    "output": "판정, 자동 예약, 처리 상태"
  },
  {
    "id": "BP-INV-01",
    "name": "열연 배정·코일 실적",
    "actor": "생산",
    "flow": "매핑 조회 → 합격 슬래브 FIFO 추천 → 배정 확정 → 코일 1개 생성·검사",
    "output": "코일 LOT, 여재"
  },
  {
    "id": "BP-INV-02",
    "name": "동시성 통제 / 보정 배치",
    "actor": "시스템",
    "flow": "재고 풀 잠금 → 재검증 → 저장 / (P2) 배치로 예약 매수 비교·보정",
    "output": "일관된 예약 매수"
  },
  {
    "id": "BP-SHP-01",
    "name": "출하·출고·밀시트",
    "actor": "영업·물류",
    "flow": "출하요청 → FIFO LOT 배정 → 출고 재검증 → CONVERTED → 밀시트·PDF",
    "output": "출고 기록, 밀시트"
  },
  {
    "id": "BP-LOT-01",
    "name": "LOT 정·역추적",
    "actor": "전원",
    "flow": "역추적(코일→원료), 정추적(원료·히트→출하)",
    "output": "계보 조회"
  },
  {
    "id": "BP-LOG-01",
    "name": "작업 로그",
    "actor": "시스템",
    "flow": "주체·대상·전후값·사유를 이벤트로 기록",
    "output": "수주·LOT 타임라인"
  },
  {
    "id": "BP-MSG-01",
    "name": "업무·알림·메신저",
    "actor": "전원",
    "flow": "방 생성 → 메시지·첨부 → 읽음 → 멘션 알림 → ERP 이동",
    "output": "메시지, 알림"
  },
  {
    "id": "BP-ACT-01",
    "name": "Message → ERP 구매요청",
    "actor": "요청자·부서장",
    "flow": "메시지 → AI 추출 → 요청자 확정 → 구매요청 생성 → 부서장 승인",
    "output": "구매요청, 로그"
  }
];
