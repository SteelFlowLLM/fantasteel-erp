# 심층 조사 Notion 내보내기

API ID: API-294
Method: POST
Path: /api/v1/ai-research/runs/:id/notion-export
관련 BP: BP-AST-01
권한: 없음 (본인 조사만)
도메인: AI·Agent
등급: EX
비고: 문서 밖 기능(2026-10-17 이슈 #384, 다시 내보내기 2026-10-22 이슈 #521). 완료한 조사만(RES-002). 본문 {version?} 없으면 지금 판. 다시 내보내면 새 페이지를 만들고 조사에는 마지막 페이지 주소·판을 남긴다. 내보내는 중이면 RES-007. 연결 오류는 INT-00x 그대로
설명: 완료한 심층 조사 보고서(고른 판)를 회사 Notion 상위 페이지 아래 새 페이지로 내보낸다
인증: AUTHENTICATED
작성 상태: 초안