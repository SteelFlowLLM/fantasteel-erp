# 심층 조사 보고서 PDF 내려받기

API ID: API-293
Method: GET
Path: /api/v1/ai-research/runs/:id/pdf
관련 BP: BP-AST-01
권한: 없음 (본인 조사만)
도메인: AI·Agent
등급: EX
비고: 문서 밖 기능(2026-10-22, 이슈 #521). ?version=n이면 그 판, 없으면 지금 보고서. 응답은 application/pdf 파일(공통 응답 포맷 아님). 남의 조사·없는 판 RES-001(404), 보고서 없음 RES-002, PDF 실패 RES-010. 한글 글꼴은 밀시트 PDF와 같은 Noto Sans KR
설명: 보고서(제목·질문·작성일·본문·표·차트 숫자 표·출처)를 PDF로 내려받는다
인증: AUTHENTICATED
작성 상태: 초안