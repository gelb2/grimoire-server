# TECH_STATUS.md — grimoire-server

> 현재 구현 상태 + 배포 현황.
> 참조: `docs/environments.md`, `TODO.md`

---

## 1. 현재 Phase

**Phase 1 — 백엔드 초기 구축** (2026-03-26 완료)

---

## 2. 구현 상태

### API 엔드포인트

| Method | Path | 상태 | Phase |
|--------|------|------|-------|
| GET | `/api/health` | 구현 완료 | 1 |
| POST | `/api/themes/generate` | 구현 완료 | 1 |
| GET | `/api/themes/:authorSlug` | 구현 완료 | 1 |
| POST | `/api/manuscripts/parse` | 구현 완료 | 1 |
| GET | `/api/authors/:slug` | 구현 완료 | 1 |
| GET | `/api/works/:authorSlug/:workSlug` | 구현 완료 | 1 |
| GET | `/api/episodes/:authorSlug/:workSlug/:episodeSlug` | 구현 완료 | 1 |
| POST | `/api/auth/register` | 미구현 | 3 |
| POST | `/api/auth/login` | 미구현 | 3 |

상세 명세는 `docs/api-contract.md` 참조.

### 아키텍처 레이어

| 레이어 | 상태 | 비고 |
|--------|------|------|
| domain/model | 구현 완료 | Author, Theme, Work, Episode, Block, Credit, Frontmatter |
| domain/port | 구현 완료 | 5개 outbound 포트 |
| application | 구현 완료 | 6개 UseCase |
| adapter/inbound | 구현 완료 | 5개 Controller + 2개 DTO |
| adapter/outbound | 구현 완료 | 4개 Prisma Repository + 1개 Claude 어댑터 |
| infrastructure | 구현 완료 | PrismaService + 환경 검증 |
| lib | 구현 완료 | Claude 래퍼 + JSON 파서 + MD 파서 |

### 인프라

| 항목 | 상태 | 비고 |
|------|------|------|
| Prisma 스키마 | 작성 완료 | 6개 모델, 마이그레이션 미실행 (DB 미연결) |
| Docker | Dockerfile 작성 완료 | 멀티스테이지 빌드 |
| CI/CD | GitHub Actions 설정 완료 | `.github/workflows/` |
| Azure 리소스 | 미생성 | Phase 2에서 생성 예정 |

---

## 3. 배포 현황

| 환경 | 상태 | URL |
|------|------|-----|
| development | 로컬만 (DB 미연결) | localhost:3000 |
| inhouse | 미배포 | - |
| production | 미배포 | - |

---

## 4. 의존성

| 패키지 | 버전 | 용도 |
|--------|------|------|
| @nestjs/* | 10.4.x | 프레임워크 |
| @prisma/client | 6.x | ORM |
| @anthropic-ai/sdk | 0.78+ | Claude API |
| class-validator | 0.14.x | DTO 검증 |
| jest / ts-jest | 29.x | 테스트 |

---

## 5. 다음 단계

- PostgreSQL 로컬 연결 + Prisma 마이그레이션 실행
- 원고 업로드 + DB 저장 API
- 작가 CRUD (작품/에피소드 생성/수정/삭제)
- API 응답 페이지네이션

---

## 6. 참조 문서

- `docs/environments.md` — 빌드 환경 (정본)
- `TODO.md` — 작업 추적
- `TESTING.md` — 테스트 현황
- `INFRASTRUCTURE.md` — Azure 구성
