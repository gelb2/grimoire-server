# TECH_STATUS.md — grimoire-server

> 현재 구현 상태 + 배포 현황.
> 이 문서는 Level 2 정본이다. 코드 변경 시 이 문서를 업데이트한다.

---

## 1. 현재 버전

최신 버전은 `CHANGELOG.md` 참조. (현재 v0.25.0)

---

## 2. 구현 상태

### API 엔드포인트

전체 엔드포인트 명세: `docs/api-contract.md` 참조.
엔드포인트 수: `docs/api-contract.md` 참조 (하드코딩 금지 — 문서 피라미드 규칙)

| 카테고리 | 상태 |
|----------|------|
| Health | 구현 완료 |
| Auth (이메일 + Google OAuth + 비밀번호 변경) | 구현 완료 |
| Theme (생성/조회/퍼블리시/CSS/프리셋/슬롯/활성화/작품배정) | 구현 완료 |
| Manuscript (파싱 + 파일 업로드) | 구현 완료 |
| Work Management (작품/에피소드 CRUD + 재업로드) | 구현 완료 |
| Author (공개 조회) | 구현 완료 |
| Content (공개 조회) | 구현 완료 |
| Social (좋아요/구독/댓글) | 구현 완료 |
| Reader (북마크/읽기 진행도) | 구현 완료 |
| Discovery (검색/인기/최신 + 페이지네이션) | 구현 완료 |
| Payment (Polar — 상품/웹훅/크레딧) | 구현 완료 |
| Admin (28개 엔드포인트 — 통계/사용자/콘텐츠/제재/신고/댓글/결제/접근로그/설정/감사로그) | 구현 완료 |
| Analysis (RAG 인덱싱/일관성 체크) | 구현 완료 |
| Chat (AI 어시스턴트 — 세션/메시지/RAG) | 구현 완료 |
| Plan (구독 플랜 + 테마 슬롯 관리) | 구현 완료 |

### 보안 인프라

| 항목 | 상태 |
|------|------|
| 데드락 방지 (SELECT FOR UPDATE) | 구현 완료 |
| 보안 접근 로그 (access_logs) | 구현 완료 |
| 관리자 감사 로그 (admin_audit_logs) | 구현 완료 |
| 사용자 제재 시스템 (user_sanctions) | 구현 완료 |
| 콘텐츠 신고 시스템 (reports) | 구현 완료 |
| 로그인 시 제재 확인 + 차단 | 구현 완료 |
| 시스템 설정 (system_settings) | 구현 완료 |

### 원고 파서 지원 포맷

| 포맷 | 파서 | 상태 |
|------|------|------|
| Markdown (.md) | md-parser.ts | 구현 완료 |
| 텍스트 (.txt) | txt-parser.ts | 구현 완료 |
| Word (.docx) | docx-parser.ts (mammoth) | 구현 완료 |
| 한글 (.hwp) | hwp-parser.ts | 구현 완료 |
| 한글 (.hwpx) | hwp-parser.ts | 구현 완료 |
| HTML (.html) | 미구현 (최후순위) | - |

### Prisma 스키마

- 정본: `prisma/schema.prisma`
- 모델 수: 23개 (schema.prisma에서 `model` 키워드로 확인)
- 설명: `SCHEMA.md`, `docs/data-model.md`

### 테스트

- 테스트 수: `npm test` 실행으로 확인 (현재 403개, 33 suites)
- 커버리지: `npx jest --coverage` 실행으로 확인 (목표 60%)

### 인프라

| 항목 | 상태 | 비고 |
|------|------|------|
| Docker | Dockerfile 작성 완료 | 멀티스테이지 빌드 + docker-entrypoint.sh |
| CI/CD | GitHub Actions 설정 완료 | `.github/workflows/` 확인 |
| Azure Container Apps | 3환경 배포 완료 | 서버 호스팅 |
| Azure Database for PostgreSQL | 3환경 설정 완료 | DB |
| Azure Container Registry | 설정 완료 | Docker 이미지 |
| Azure Blob Storage | 설정 완료 | grimoire0storage (커버 + 테마 CSS) |
| Rate Limiting | 적용 완료 | NestJS Throttler 전면 적용 |
| 파일 업로드 | 적용 완료 | Multer (md/txt/docx/hwp/hwpx) |

상세: `INFRASTRUCTURE.md` 참조.

---

## 3. 배포 현황

| 환경 | 상태 | URL |
|------|------|-----|
| localhost | 로컬 개발 | localhost:3000 (Docker DB) |
| development | 배포 완료 | dev-api.grimoire-book.com |
| inhouse | 배포 완료 | inhouse-api.grimoire-book.com |
| production | 배포 완료 | api.grimoire-book.com |

---

## 4. 다음 단계

- Polar KYC + 한국 payout 승인 (사용자 액션)
- Redis 캐시 (테마 DB 호출 캐싱)
- AI 채팅 스트리밍 (SSE)
- HTML 파서 (최후순위)

---

## 5. 참조 문서

- 루트 `SYNC_STATUS.md` — 서버-웹 연결 현황 + 갭 (정본)
- `docs/environments.md` — 빌드 환경 (정본)
- `docs/api-contract.md` — API 엔드포인트 명세 (정본)
- `TODO.md` — 남은 작업
- `TESTING.md` — 테스트 전략
- `INFRASTRUCTURE.md` — Azure 구성
