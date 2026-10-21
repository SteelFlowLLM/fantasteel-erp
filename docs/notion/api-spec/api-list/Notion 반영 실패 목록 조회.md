# Notion 반영 실패 목록 조회

API ID: API-284
Method: GET
Path: /api/v1/integrations/notion/sync-failures
관련 BP: 
권한: ORG_MANAGE (VIEW 이상)
도메인: 인증·조직
등급: P3
비고: 문서 밖 기능(2026-10-22, 이슈 #518). Notion 업무 공간 반영(일정·회의록·할 일)에 실패해 DB(notion_sync_failure)에 남은 행: 종류(schedule_event·meeting_minutes·task)·id·제목·실패 횟수·마지막 이유·결과 모름 여부·다음 자동 시도·처음/마지막 실패 시각. 최근 실패순. 서버를 다시 띄워도 남는다. 지워진 행의 줄은 치운다
설명: 관리자가 Notion 반영 실패 목록을 본다
인증: AUTHENTICATED
작성 상태: 초안