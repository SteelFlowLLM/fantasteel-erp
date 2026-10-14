import { describe, expect, it } from 'vitest';
import {
  ACTION_TYPE_CATALOG,
  getConfirmFailureTitle,
  countByDraftStatus,
  buildDraftFlowSteps,
  buildDraftForm,
  buildDraftPayload,
  getExecutionFailure,
  isFieldUnresolved,
  isSameDraftForm,
  getRequisitionStatusDisplay,
  formatTonInput,
} from '@/features/actionDrafts/lib/draftDisplay';

describe('초안 흐름 단계 (REQ-ACT-003)', () => {
  it('지금 상태는 진행 중, 앞은 완료, ERP 반영은 모두 완료', () => {
    expect(buildDraftFlowSteps('WAITING_APPROVAL').map((s) => `${s.label}:${s.state}`)).toEqual(['생성:done', '확인 대기:run', '확정:todo', 'ERP 반영:todo']);
    expect(buildDraftFlowSteps('APPROVED').map((s) => s.state)).toEqual(['done', 'done', 'run', 'todo']);
    expect(buildDraftFlowSteps('EXECUTED').every((s) => s.state === 'done')).toBe(true);
  });

  it('반려는 확인 대기 다음에 반려로 끝난다', () => {
    expect(buildDraftFlowSteps('REJECTED').map((s) => `${s.label}:${s.state}`)).toEqual(['생성:done', '확인 대기:done', '반려:run']);
  });
});

describe('실행 결과 읽기', () => {
  it('실패 결과만 돌려준다', () => {
    expect(getExecutionFailure({ attempts: 2, errorCode: 'PUR-001', message: '승인권자 없음', targetType: null, targetId: null, targetNo: null })).toEqual({
      attempts: 2,
      errorCode: 'PUR-001',
      message: '승인권자 없음',
    });
    expect(getExecutionFailure({ targetType: 'purchase_requisition', targetId: 7, targetNo: 'PR-2610-0001', attempts: 1, errorCode: null })).toBeNull();
    expect(getExecutionFailure(null)).toBeNull();
    expect(getConfirmFailureTitle('ACT-001')).toBe('아직 확정할 수 없어요');
    expect(getConfirmFailureTitle('PUR-001')).toBe('승인권자가 없어 구매요청을 만들지 못했어요');
  });
});

describe('입력 폼', () => {
  const payload = { itemId: 3, requestedTon: '20.000', desiredReceiptDate: '2026-10-20', requestReason: null };

  it('저장된 톤은 끝자리 0을 지워 보이고, 빈칸은 null로 저장한다', () => {
    expect(formatTonInput('20.000')).toBe('20');
    expect(formatTonInput('1.500')).toBe('1.5');
    expect(formatTonInput(null)).toBe('');
    const form = buildDraftForm(payload);
    expect(form).toEqual({ itemId: 3, requestedTon: '20', desiredReceiptDate: '2026-10-20', requestReason: '' });
    expect(buildDraftPayload({ ...form, requestedTon: ' ', requestReason: ' 10월 생산분 ' })).toEqual({
      itemId: 3,
      requestedTon: null,
      desiredReceiptDate: '2026-10-20',
      requestReason: '10월 생산분',
    });
    expect(isSameDraftForm(form, { ...form, requestedTon: '20 ' })).toBe(true);
    expect(isSameDraftForm(form, { ...form, itemId: null })).toBe(false);
  });

  it('미확정 표시는 저장된 값 기준이고, 고치는 중인 칸은 뺀다', () => {
    const saved = buildDraftForm({ itemId: null, requestedTon: null, desiredReceiptDate: null, requestReason: null });
    const unresolved = ['원료 품목', '수량(톤)', '희망 입고일'];
    expect(isFieldUnresolved('itemId', unresolved, saved, saved)).toBe(true);
    expect(isFieldUnresolved('requestedTon', unresolved, { ...saved, requestedTon: '20' }, saved)).toBe(false);
    expect(isFieldUnresolved('requestReason', unresolved, saved, saved)).toBe(false);
  });
});

describe('표시', () => {
  it('상태별 개수와 구매요청 상태 표시명', () => {
    expect(countByDraftStatus([{ draftStatus: 'WAITING_APPROVAL' }, { draftStatus: 'EXECUTED' }, { draftStatus: 'WAITING_APPROVAL' }])).toMatchObject({
      ALL: 3,
      WAITING_APPROVAL: 2,
      EXECUTED: 1,
      REJECTED: 0,
    });
    expect(getRequisitionStatusDisplay('WAITING_APPROVAL')).toEqual({ label: '승인 대기', tone: 'wait' });
    expect(getRequisitionStatusDisplay('ORDERED')).toEqual({ label: '발주 완료', tone: 'ok' });
  });
});

describe('초안 업무 유형 등록부 (REQ-ACT-004)', () => {
  it('구매요청 생성만 실행할 수 있고, 추출 스키마는 원료 품목·수량(톤)·희망 입고일·요청자, 요청 근거는 스키마 밖 선택 입력이다', () => {
    const active = ACTION_TYPE_CATALOG.filter((entry) => entry.active);
    expect(active.map((entry) => entry.actionType)).toEqual(['PURCHASE_REQUISITION_CREATE']);
    expect(active[0].schemaFieldLabels).toEqual(['원료 품목', '수량(톤)', '희망 입고일', '요청자']);
    expect(active[0].optionalInputLabels).toEqual(['요청 근거']);
  });

  it('나머지 유형은 모두 P2 준비 중이고 추출 스키마가 없다', () => {
    const inactive = ACTION_TYPE_CATALOG.filter((entry) => !entry.active);
    expect(inactive).toHaveLength(5);
    expect(inactive.every((entry) => entry.grade === 'P2' && entry.schemaFieldLabels.length === 0)).toBe(true);
  });
});
