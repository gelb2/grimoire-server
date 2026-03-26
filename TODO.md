# TODO — grimoire-server

## Phase 1 (완료)
- [x] NestJS 프로젝트 초기화 (Hexagonal)
- [x] Prisma 스키마 작성
- [x] Claude API 래퍼
- [x] 테마 생성/조회 API
- [x] MD 파서 이관
- [x] 원고 파싱 API
- [x] 작가/작품/에피소드 조회 API
- [x] 크레딧 시스템
- [x] Jest 테스트
- [x] Dockerfile

## Phase 2 (진행 중)
- [x] DB 스키마 v0.2 (social_accounts, view_count, password_hash, baked_css_url, source_format)
- [x] JWT 기반 회원가입/로그인 API (bcryptjs)
- [x] JwtAuthGuard (Bearer 토큰 인증)
- [x] TXT 파서 + 포맷 자동 감지 (detectFormat)
- [ ] Prisma 마이그레이션 실행 (PostgreSQL 연결)
- [ ] 원고 업로드 + DB 저장 API 구현
- [ ] 작가 CRUD (작품/에피소드 생성/수정/삭제)
- [ ] API 응답 페이지네이션
- [ ] 테마 Baking API (CSS 파일 생성 + CDN 업로드)

## Phase 3 (완료 항목 포함)
- [x] 좋아요 토글 API (`POST /social/likes/:episodeId`)
- [x] 구독 토글 API (`POST /social/subscriptions/:authorId`)
- [x] 댓글 CRUD API (생성/목록/삭제)
- [x] Like, Subscription, Comment Prisma 모델
- [x] 전수조사 지적사항 수정 (DTO definite assignment, api-contract 문서화)
- [ ] Google OAuth 실제 연동 (Client ID 필요)
- [ ] 크레딧 충전 API (PAYAPP 실제 연동 — API 키 필요)
- [ ] 관리자 API

## Phase 4 (예정)
- [ ] PostgreSQL 실제 연결 + Prisma 마이그레이션 실행
- [ ] Docker 빌드 + Azure 배포
- [ ] 크레딧-원화-AI토큰 비용 정밀 계산식 구현
- [ ] 조회수 통계 차트 (대시보드)

## Phase 5 (연구 단계)
- [ ] YECHANGPE RAG/Vector 코드 이식 (OpenAI/Claude API 키 세팅 필요)
- [ ] 소설 설정 붕괴/톤 일관성 체크 API
- [ ] HTML 파서 (최후순위)
