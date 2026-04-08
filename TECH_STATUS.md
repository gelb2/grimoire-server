# TECH_STATUS.md — grimoire-server

> 현재 구현 상태 + 배포 현황.
> 이 문서는 Level 2 정본이다. 코드 변경 시 이 문서를 업데이트한다.

---

## 1. 현재 버전

최신 버전은 `CHANGELOG.md` 참조.

---

## 2. 구현 상태

### API 엔드포인트

전체 엔드포인트 명세: `docs/api-contract.md` 참조.
엔드포인트 수: `docs/api-contract.md` 참조 (하드코딩 금지 — 문서 피라미드 규칙)

| 카테고리 | 상태 |
|----------|------|
| Health | 구현 완료 |
| Auth (이메일 + Google OAuth) | 구현 완료 |
| Theme (생성/조회/퍼블리시/CSS/프리셋/슬롯) | 구현 완료 |
| Manuscript (파싱 + 파일 업로드) | 구현 완료 |
| Work Management (작품/에피소드 CRUD) | 구현 완료 |
| Author (공개 조회) | 구현 완료 |
| Content (공개 조회) | 구현 완료 |
| Social (좋아요/구독/댓글) | 구현 완료 |
| Reader (북마크/읽기 진행도) | 구현 완료 |
| Discovery (검색/인기/최신 + 페이지네이션) | 구현 완료 |
| Payment (상품/웹훅/크레딧) | 구현 완료 |
| Admin (통계/크레딧 부여) | 구현 완료 |
| Analysis (RAG 인덱싱/일관성 체크) | 구현 완료 |
| Chat (AI 어시스턴트 — 세션/메시지/RAG) | 구현 완료 |
| Plan (구독 플랜 + 테마 슬롯 관리) | 구현 완료 |

### 원고 파서 지원 포맷

| 포맷 | 파서 | 상태 |
|------|------|------|
| Markdown (.md) | md-parser.ts | 구현 완료 |
| 텍스트 (.txt) | txt-parser.ts | 구현 완료 |
| Word (.docx) | docx-parser.ts (mammoth) | 구현 완료 |
| 한글 (.hwp) | hwp-parser.ts | 구현 완료 |
| 한글 (.hwpx) | hwp-parser.ts | 구현 완료 |
| HTML (.html) | 미구현 (최후순위) | - |

### 아키텍처 레이어

> 정확한 수량은 코드 디렉토리를 직접 확인한다.

| 레이어 | 확인 방법 |
|--------|----------|
| Controller | `ls src/adapter/inbound/http/controller/` |
| UseCase | `ls src/application/` |
| Domain Model | `ls src/domain/model/` |
| Outbound Port | `ls src/domain/port/outbound/` |
| Persistence Adapter | `ls src/adapter/outbound/persistence/` |

### Prisma 스키마

- 정본: `prisma/schema.prisma`
- 모델 수: `prisma/schema.prisma`에서 `model` 키워드로 확인
- 설명: `SCHEMA.md`
- 마이그레이션: 실행 완료 (dev/inhouse/prod DB 테이블 생성)

### 테스트

- 테스트 수: `npm test` 실행으로 확인
- 커버리지: `npx jest --coverage` 실행으로 확인 (목표 60%)
- 테스트 전략: `TESTING.md` 참조

### 인프라

| 항목 | 상태 | 비고 |
|------|------|------|
| Docker | Dockerfile 작성 완료 | 멀티스테이지 빌드 + docker-entrypoint.sh |
| CI/CD | GitHub Actions 설정 완료 | `.github/workflows/` 확인 |
| Azure Container Apps | 3환경 배포 완료 | 서버 호스팅 |
| Azure Database for PostgreSQL | 3환경 설정 완료 | DB |
| Azure Container Registry | 설정 완료 | Docker 이미지 |
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

> DNS 설정 미완 — Cloudflare CNAME 레코드 설정 필요 (`INFRASTRUCTURE.md` §10 참조)

---

## 4. 다음 단계

- Prisma 마이그레이션 히스토리 정비 (squash + 정리)
- Cloudflare DNS CNAME 레코드 설정
- ~~Google OAuth 실제 연동~~ (구현 완료)
- 결제 게이트웨이 실제 연동 (API 키 필요)
- Redis 캐시 (테마 DB 호출 캐싱)
- 크레딧-원화-AI토큰 비용 정밀 계산식 구현
- 계정 잠금 정책 + 감사 로그
- HTML 파서 (최후순위)

---

## 5. 참조 문서

- 루트 `SYNC_STATUS.md` — 서버-웹 연결 현황 + 갭 (정본)
- `docs/environments.md` — 빌드 환경 (정본)
- `docs/api-contract.md` — API 엔드포인트 명세 (정본)
- `TODO.md` — 남은 작업
- `TESTING.md` — 테스트 전략
- `INFRASTRUCTURE.md` — Azure 구성
