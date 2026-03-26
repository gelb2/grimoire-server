# TECH_STATUS.md — grimoire-server

> 현재 구현 상태 + 배포 현황.
> 참조: `docs/environments.md`, `TODO.md`

---

## 1. 현재 Phase

**Phase 2 — 인증 + DB v0.2 + TXT 파서** (2026-03-26 진행 중)

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
| POST | `/api/auth/register` | 구현 완료 | 2 |
| POST | `/api/auth/login` | 구현 완료 | 2 |
| GET | `/api/auth/profile` | 구현 완료 | 2 |

상세 명세는 `docs/api-contract.md` 참조.

### 아키텍처 레이어

| 레이어 | 상태 | 비고 |
|--------|------|------|
| domain/model | 구현 완료 | Author, Theme, Work, Episode, Block, Credit, Frontmatter |
| domain/port | 구현 완료 | 5개 outbound 포트 |
| application | 구현 완료 | 7개 UseCase (+AuthUseCase) |
| adapter/inbound | 구현 완료 | 6개 Controller (+Auth) + 3개 DTO (+Auth) + 1개 Guard |
| adapter/outbound | 구현 완료 | 4개 Prisma Repository + 1개 Claude 어댑터 |
| infrastructure | 구현 완료 | PrismaService + 환경 검증 |
| lib | 구현 완료 | Claude 래퍼 + JSON 파서 + MD 파서 |

### 인프라

| 항목 | 상태 | 비고 |
|------|------|------|
| Prisma 스키마 | v0.2 작성 완료 | 7개 모델 (+SocialAccount), 마이그레이션 미실행 (DB 미연결) |
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
| @nestjs/jwt | 10.x | JWT 인증 |
| @prisma/client | 6.x | ORM |
| @anthropic-ai/sdk | 0.78+ | Claude API |
| bcryptjs | 2.x | 비밀번호 해싱 |
| class-validator | 0.14.x | DTO 검증 |
| jest / ts-jest | 29.x | 테스트 |

---

## 5. 다음 단계

- PostgreSQL 로컬 연결 + Prisma 마이그레이션 실행
- 원고 업로드 + DB 저장 API
- 작가 CRUD (작품/에피소드 생성/수정/삭제)
- 테마 Baking API (CSS 파일 생성 + CDN 업로드)
- OAuth 소셜 로그인 (Kakao/Google/Apple)

---

## 6. 참조 문서

- `docs/environments.md` — 빌드 환경 (정본)
- `TODO.md` — 작업 추적
- `TESTING.md` — 테스트 현황
- `INFRASTRUCTURE.md` — Azure 구성
