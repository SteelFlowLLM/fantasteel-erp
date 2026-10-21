# Notion 반영 실패 한 건 다시 시도

API ID: API-289
Method: POST
Path: /api/v1/integrations/notion/sync-failures/:failureId/retry
관련 BP: 
권한: ORG_MANAGE (USE)
도메인: 인증·조직
등급: P3
비고: 문서 밖 기능(2026-10-22, 이슈 #518). 실패 목록의 한 건만 다시 시도한다. 없는(이미 처리된) 건은 COM-003. Notion에 만들어졌는지 알 수 없었던 건(결과 모름)은 이미 만들어졌다면 같은 페이지가 하나 더 생기므로 화면이 Notion을 먼저 확인하라고 묻는다
설명: 관리자가 반영에 실패한 항목 하나를 다시 시도한다
인증: AUTHENTICATED
작성 상태: 초안