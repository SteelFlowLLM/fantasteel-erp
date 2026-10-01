'use client';

// Voice2ERP 회의록 (P2 준비 중). 옛 B안 화면 3개(목록·새 회의·정리 결과)를 탭으로 보여 준다. 탭 전환만 화면 상태이고 기능·저장은 없다.
// 고친 점 (reports/6 C-2·C-5, PLAN 7장): 원본 전사와 AI 요약을 나누고, AI_GENERATED 배지를 회의 정리 전체에 붙이지 않는다
// (초안 상태는 구매요청 초안으로 보낸 뒤에만, 공통 코드 표시명으로). 회의록 항목은 ERD만, 채팅방 공유·안건·수주 연결은 뺐다.
import { useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { ComingSoonArea, SoonButton } from '@/components/ComingSoon';
import { Field } from '@/components/Field';
import { Icon, type IconName } from '@/components/Icon';
import { Input } from '@/components/Input';
import { KvList } from '@/components/KvList';
import { PageHead } from '@/components/Page';
import { Steps } from '@/components/Steps';
import { Table, Td, Th } from '@/components/Table';
import { Tabs } from '@/components/Tabs';
import { Tag } from '@/components/Tag';
import { DRAFT_STATUS_LABEL, NOTIFICATION_TYPE_LABEL, ROLE_LABEL, TASK_STATUS_LABEL } from '@/codes';
import { DRAFT_FLOW } from '@/features/agent/agentExample';
import {
  AiBrief,
  AiCard,
  DaySeparator,
  ExampleNotice,
  LockHint,
  MasterItem,
  OriginLine,
  SourceList,
} from '@/features/agent/components/SoonExampleParts';
import {
  ATTENDEES,
  DECISIONS,
  EXTRACTED_TASKS,
  MEETING_MINUTES_LIST,
  PURCHASE_ITEM,
  SELECTED_MEETING_MINUTES,
  SUMMARY,
  TRANSCRIPT,
  isTaskReady,
} from '@/features/meetings/meetingExample';
import { cn } from '@/lib/cn';

type MeetingTab = 'list' | 'new' | 'result';

const TAB_ITEMS: readonly { key: MeetingTab; label: string }[] = [
  { key: 'list', label: '목록' },
  { key: 'new', label: '새 회의' },
  { key: 'result', label: '정리 결과' },
];

const readyTaskCount = EXTRACTED_TASKS.filter(isTaskReady).length;

function AttendeeChips() {
  return (
    <div className="flex flex-wrap gap-1">
      {ATTENDEES.map((attendee) => (
        <span key={attendee.employeeName} className="inline-flex h-6 items-center gap-1 rounded-xl border border-line-strong bg-surface pr-2 pl-0.5 text-xs">
          <Avatar name={attendee.employeeName} size="sm" />
          {attendee.employeeName}
          <span className="text-cap text-ink-3">{ROLE_LABEL[attendee.roleCode]}</span>
        </span>
      ))}
    </div>
  );
}

/** 원본 전사 한 줄 (사람 발언, AI 아님) */
function TranscriptRow({ at, speaker, text, highlight }: { at: string; speaker: string; text: string; highlight?: boolean }) {
  return (
    <div className={cn('grid grid-cols-[40px_minmax(0,1fr)] gap-x-2 px-3.5 py-1.5 text-xs leading-[17px]', highlight && 'bg-wait-bg')}>
      <time className="font-mono text-[11px] text-ink-3">{at}</time>
      <span>
        <b className="font-semibold">{speaker}</b> {text}
        {highlight ? (
          <span className="mt-1 block">
            <Tag size="sm" tone="outline">
              구매 관련 발언
            </Tag>
          </span>
        ) : null}
      </span>
    </div>
  );
}

function TranscriptCardHead({ meta }: { meta: string }) {
  return (
    <CardHead
      title={
        <span className="flex items-center gap-1.5">
          <Icon name="mic" />
          전체 기록 (원본 전사)
        </span>
      }
      meta={meta}
    />
  );
}

function SummaryBody() {
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-cap font-semibold text-ai-strong">요약</span>
        <ol className="flex flex-col gap-0.5 text-sm leading-[19px]">
          {SUMMARY.map((line, index) => (
            <li key={line}>
              {index + 1}. {line}
            </li>
          ))}
        </ol>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-cap font-semibold text-ai-strong">결정사항 {DECISIONS.length}</span>
        <ul className="flex flex-col gap-1 text-sm leading-[19px]">
          {DECISIONS.map((decision) => (
            <li key={decision.text} className="flex items-start gap-1.5">
              <Icon name="check" size="sm" className="mt-0.5 text-ok" />
              <span className="min-w-0 flex-1">{decision.text}</span>
              <span className="flex-none text-cap text-ink-3">원문 {decision.at}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function ListDesign() {
  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <section aria-label="회의 목록" className="flex min-h-0 w-80 flex-none flex-col rounded-md border border-line bg-surface shadow-1">
        <div className="flex flex-col gap-2.5 border-b border-line px-4 pt-3.5 pb-2.5">
          <div className="flex items-center gap-2">
            <b className="text-base font-semibold">회의 4건</b>
            <span className="text-cap text-ink-3">최근 7일</span>
            <SoonButton variant="primary" size="sm" className="ml-auto">
              <Icon name="plus" />새 회의
            </SoonButton>
          </div>
          <Input type="search" leadingIcon="search" placeholder="제목·참석자" aria-label="회의 검색" disabled />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {MEETING_MINUTES_LIST.map((group) => (
            <div key={group.day}>
              <DaySeparator>{group.day}</DaySeparator>
              {group.items.map((meeting) => (
                <MasterItem key={meeting.key} active={meeting.key === 'weekly'}>
                  <b className="text-sm font-semibold">{meeting.title}</b>
                  <span className="text-cap text-ink-3 tabular-nums">{meeting.meta}</span>
                  <span className="text-cap text-ink-2">{meeting.sub}</span>
                </MasterItem>
              ))}
            </div>
          ))}
        </div>
      </section>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-auto">
        <PageHead
          crumb={
            <>
              회의록
              <Icon name="chevron-right" size="sm" />
              {SELECTED_MEETING_MINUTES.meetingDate} {SELECTED_MEETING_MINUTES.time}
            </>
          }
          title={SELECTED_MEETING_MINUTES.title}
          actions={
            <SoonButton variant="primary">
              결과 확인하고 등록
              <Icon name="arrow-right" />
            </SoonButton>
          }
        />
        <Card className="flex-none">
          <CardBody className="grid grid-cols-[repeat(3,max-content)_minmax(0,1fr)] gap-x-7">
            <KvList items={[{ label: '회의 날짜', value: `${SELECTED_MEETING_MINUTES.meetingDate} ${SELECTED_MEETING_MINUTES.time} · ${SELECTED_MEETING_MINUTES.duration}` }]} />
            <KvList items={[{ label: '입력', value: '음성 파일' }]} />
            <KvList items={[{ label: '작성', value: SELECTED_MEETING_MINUTES.createdEmployeeName }]} />
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-3">참석자 {ATTENDEES.length}명</span>
              <AttendeeChips />
            </div>
          </CardBody>
        </Card>
        <div className="grid min-h-0 flex-none grid-cols-2 gap-3.5">
          <Card>
            <TranscriptCardHead meta={`발언 ${TRANSCRIPT.length} · 사람이 말한 그대로`} />
            <div className="flex flex-col py-1.5">
              {TRANSCRIPT.slice(0, 6).map((line) => (
                <TranscriptRow key={line.at} at={line.at} speaker={line.speaker} text={line.text} />
              ))}
              <span className="px-3.5 pt-1 text-cap text-ink-3">… 이후 발언 2개 · 38:02까지</span>
            </div>
          </Card>
          <AiCard title="AI 요약" meta="초안 · 확인 전">
            <SummaryBody />
            <OriginLine icon="task">
              할 일 {EXTRACTED_TASKS.length} (담당·마감 확인 필요 {EXTRACTED_TASKS.length - readyTaskCount}) · 구매 관련 1 → 구매요청 초안으로 보낼 수 있어요
            </OriginLine>
            <SourceList items={[{ icon: 'mic', label: '전체 기록(원본 전사)', note: `발언 ${TRANSCRIPT.length}` }]} />
          </AiCard>
        </div>
      </div>
    </div>
  );
}

const INPUT_TABS: readonly { key: string; label: string; icon: IconName; active?: boolean }[] = [
  { key: 'record', label: '녹음', icon: 'mic' },
  { key: 'upload', label: '음성 파일 업로드', icon: 'upload', active: true },
];

function NewDesign() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <PageHead
        crumb={
          <>
            회의록
            <Icon name="chevron-right" size="sm" />새 회의
          </>
        }
        title="새 회의 기록"
        actions={
          <Button icon="chevron-left" disabled>
            회의 목록
          </Button>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] gap-4">
        <Card>
          <div role="tablist" aria-label="입력 방식" className="flex flex-none gap-1 border-b border-line px-3">
            {INPUT_TABS.map((tab) => (
              <span
                key={tab.key}
                role="tab"
                aria-selected={tab.active ?? false}
                className={cn(
                  '-mb-px inline-flex h-[38px] items-center gap-1.5 border-b-2 px-3 text-sm',
                  tab.active ? 'border-brand font-semibold text-brand' : 'border-transparent font-medium text-ink-2',
                )}
              >
                <Icon name={tab.icon} size="sm" />
                {tab.label}
              </span>
            ))}
            <span className="ml-auto self-center text-cap text-ink-3">회의 음성으로 기록해요 · 입력 방식은 구현 단계에서 정해요</span>
          </div>
          <CardBody className="flex-1 gap-4 px-6 py-5">
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-line-strong bg-surface-2 px-6 py-6 text-center">
              <span className="inline-flex size-11 items-center justify-center rounded-full bg-brand-tint text-brand">
                <Icon name="upload" size="lg" />
              </span>
              <b className="text-base font-semibold">회의 음성 파일을 끌어 놓거나 선택하세요</b>
              <span className="text-cap text-ink-3">음성 파일 · 형식과 용량 제한은 구현 단계에서 정해요</span>
              <SoonButton size="sm">
                <Icon name="clip" />
                파일 선택
              </SoonButton>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <b className="text-sm font-semibold">선택한 파일</b>
                <span className="text-cap text-ink-3">파일을 고르면 이렇게 보여요 (예시)</span>
              </div>
              <div className="flex items-center gap-3 rounded-md border border-line px-4 py-3.5">
                <span className="inline-flex size-10 items-center justify-center rounded-sm bg-run-bg text-run">
                  <Icon name="mic" size="lg" />
                </span>
                <div className="flex flex-col gap-0.5">
                  <b className="font-mono text-sm">주간생산회의_1001.m4a</b>
                  <span className="text-cap text-ink-3">음성 · 42분</span>
                </div>
              </div>
            </div>
          </CardBody>
          <CardFoot className="px-6">
            <span className="text-cap text-ink-3">음성을 전체 기록(STT)으로 바꾼 뒤 AI가 정리해요</span>
            <SoonButton className="ml-auto">취소</SoonButton>
            <SoonButton variant="ai">AI 정리 시작</SoonButton>
          </CardFoot>
        </Card>

        <Card>
          <CardHead title="회의 정보" meta={`작성 ${SELECTED_MEETING_MINUTES.createdEmployeeName}`} />
          <CardBody className="flex-1 gap-3.5">
            <Field label="제목" htmlFor="meeting-title" required>
              <Input id="meeting-title" readOnly defaultValue={SELECTED_MEETING_MINUTES.title} />
            </Field>
            <Field label="회의 날짜" htmlFor="meeting-date" required>
              <Input id="meeting-date" readOnly leadingIcon="calendar" defaultValue={SELECTED_MEETING_MINUTES.meetingDate} />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-2">참석자 {ATTENDEES.length}명</span>
              <AttendeeChips />
              <span className="text-cap text-ink-3">조직도에서 사원을 골라요</span>
            </div>
            <AiBrief className="mt-auto items-start">
              <b>Voice2ERP</b> 음성 → 전체 기록 → 요약·결정사항·할 일 초안 → 확인 후 등록. AI는 등록하지 않아요.
            </AiBrief>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ResultDesign() {
  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <Card className="w-80 flex-none">
        <TranscriptCardHead meta={`발언 ${TRANSCRIPT.length} · ${SELECTED_MEETING_MINUTES.duration}`} />
        <div className="border-b border-line px-3.5 py-2">
          <Input type="search" leadingIcon="search" placeholder="전체 기록 검색" aria-label="전체 기록 검색" disabled />
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {TRANSCRIPT.map((line) => (
            <TranscriptRow key={line.at} at={line.at} speaker={line.speaker} text={line.text} highlight={line.purchaseRelated} />
          ))}
        </div>
        <CardFoot>
          <LockHint icon="mic">원본 전사는 AI가 고치지 않아요</LockHint>
        </CardFoot>
      </Card>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-auto">
        <PageHead
          crumb={
            <>
              회의록
              <Icon name="chevron-right" size="sm" />
              {SELECTED_MEETING_MINUTES.title}
            </>
          }
          title="정리 결과 확인"
          actions={
            <Button icon="chevron-left" disabled>
              회의 목록
            </Button>
          }
        />

        <AiCard title="AI 요약" meta={`초안 · 확인 전 · ${SELECTED_MEETING_MINUTES.meetingDate} ${SELECTED_MEETING_MINUTES.time} · ${ATTENDEES.length}명`} className="flex-none">
          <SummaryBody />
        </AiCard>

        <div className="grid min-h-0 flex-none grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3.5">
          <Card>
            <CardHead title={`할 일 ${EXTRACTED_TASKS.length}`} meta="담당·마감을 확인한 항목만 업무로 등록" />
            <CardBody flush>
              <Table>
                <thead>
                  <tr>
                    <Th align="center" className="w-14">
                      등록
                    </Th>
                    <Th className="w-28">담당</Th>
                    <Th>할 일</Th>
                    <Th className="w-24">마감일</Th>
                  </tr>
                </thead>
                <tbody>
                  {EXTRACTED_TASKS.map((task) => {
                    const ready = isTaskReady(task);
                    return (
                      <tr key={task.key} data-risk={!ready || undefined}>
                        <Td align="center">
                          <input type="checkbox" checked={ready} disabled readOnly aria-label="업무로 등록" />
                        </Td>
                        <Td>{task.assigneeName ?? <span className="text-danger">확인 필요</span>}</Td>
                        <Td className="whitespace-normal py-1.5">
                          <span className="block font-medium">{task.title}</span>
                          <span className="text-cap text-ink-3">원문 {task.at}</span>
                        </Td>
                        <Td className="tabular-nums">{task.dueDate ?? <span className="text-danger">확인 필요</span>}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              <div className="flex flex-col gap-1 px-4 py-3 text-cap text-ink-3">
                <span>담당자·마감일이 모호한 항목은 확인 전에는 등록하지 않아요.</span>
                <span>
                  등록하면 업무·알림에 &lsquo;{TASK_STATUS_LABEL.OPEN}&rsquo; 업무로 들어가고, 담당자에게 &lsquo;{NOTIFICATION_TYPE_LABEL.TASK_ASSIGNED}&rsquo; 알림이 가요.
                </span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHead
              title={
                <span className="flex items-center gap-1.5">
                  <Icon name="cart" />
                  구매 관련 항목 1
                </span>
              }
              meta="AI가 찾은 항목 · 보내기 전"
            />
            <CardBody>
              <KvList
                items={[
                  {
                    label: '원료',
                    value: (
                      <>
                        {PURCHASE_ITEM.rawMaterial} <span className="font-mono text-xs text-ink-3">{PURCHASE_ITEM.rawMaterialCode}</span>
                      </>
                    ),
                  },
                  { label: '수량', value: `${PURCHASE_ITEM.requiredTon} t` },
                  { label: '희망 입고일', value: PURCHASE_ITEM.desiredReceiptDate },
                  { label: '요청자', value: PURCHASE_ITEM.requesterName },
                ]}
              />
              <OriginLine icon="mic">
                {SELECTED_MEETING_MINUTES.title} · {PURCHASE_ITEM.requesterName} {PURCHASE_ITEM.at} &ldquo;철광석 재고를 보니 …&rdquo;
              </OriginLine>
              <span className="text-cap text-ink-3">보내면 Message → ERP 구매요청 초안이 되고, 요청자가 확인·수정한 뒤 확정해요. 구매요청은 요청자 소속 부서장이 승인해요.</span>
              <div className="flex flex-col gap-1.5">
                <span className="text-cap text-ink-3">보낸 뒤 초안 상태</span>
                <Steps items={DRAFT_FLOW.map((status) => ({ key: status, label: DRAFT_STATUS_LABEL[status], state: 'todo' as const }))} />
              </div>
              <SoonButton variant="ai-outline" className="self-start">
                <Icon name="cart" />
                구매요청 초안으로 보내기
              </SoonButton>
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-none items-center gap-2 rounded-md border border-line bg-surface px-3.5 py-2.5">
          <LockHint icon="info">AI 요약은 초안이에요 · 확인 전엔 업무가 등록되지 않아요</LockHint>
          <SoonButton variant="primary" className="ml-auto">
            <Icon name="check" />
            확인하고 업무 등록 ({readyTaskCount})
          </SoonButton>
        </div>
      </div>
    </div>
  );
}

export function MeetingScreen() {
  const [tab, setTab] = useState<MeetingTab>('list');
  return (
    <>
      {/* 탭은 흐려지는 영역 밖에 둬서 화면 3개를 눌러 볼 수 있다 */}
      <div className="flex flex-none items-end gap-3">
        <Tabs items={TAB_ITEMS} active={tab} onChange={setTab} ariaLabel="회의록 화면 보기" className="flex-1" />
      </div>
      <ComingSoonArea grade="P2" title="Voice2ERP 회의록">
        <ExampleNotice />
        {tab === 'list' ? <ListDesign /> : tab === 'new' ? <NewDesign /> : <ResultDesign />}
      </ComingSoonArea>
    </>
  );
}
