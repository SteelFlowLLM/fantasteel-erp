# Notion 반영 실패 전체 다시 시도

API ID: API-285
Method: POST
Path: /api/v1/integrations/notion/sync-failures/retry
관련 BP: 
권한: ORG_MANAGE (USE)
도메인: 인증·조직
등급: P3
비고: 문서 밖 기능(2026-10-22, 이슈 #518). 남은 반영 실패의 미룬 시각을 지금으로 당기고 자동 반영과 같은 길로 한 번 반영해 끝나기를 기다린다. 응답: 다시 시도한 건수·성공·실패·남은 목록. Notion 연결·업무 공간이 없으면 INT-002. 한 번에 종류마다 100행까지, 남은 것은 다음 반영(1분 안)이 잇는다
설명: 관리자가 반영에 실패한 항목을 모두 다시 시도한다
인증: AUTHENTICATED
작성 상태: 초안