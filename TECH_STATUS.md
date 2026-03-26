# TECH_STATUS.md — grimoire-server

> 현재 구현 상태 + 배포 현황.
> 이 문서는 Level 2 정본이다. 코드 변경 시 이 문서를 업데이트한다.

---

## 1. 현재 Phase

**Phase 5 완료 — 전 기능 구현 완료** (인프라 연결 + 실서비스 배포 남음)

---

## 2. 구현 상태

### API 엔드포인트

전체 엔드포인트 명세: `docs/api-contract.md` 참조.

| 카테고리 | 상태 |
|----------|------|
| Health | 구현 완료 |
| Auth (이메일 + Google OAuth) | 구현 완료 |
| Theme (생성/조회/퍼블리시/CSS) | 구현 완료 |
| Manuscript (파싱) | 구현 완료 |
| Work Management (작품/에피소드 CRUD) | 구현 완료 |
| Author (공개 조회) | 구현 완료 |
| Content (공개 조회) | 구현 완료 |
| Social (좋아요/구독/댓글) | 구현 완료 |
| Reader (북마크/읽기 진행도) | 구현 완료 |
| Discovery (검색/인기/최신) | 구현 완료 |
| Payment (상품/웹훅/크레딧) | 구현 완료 |
| Admin (통계/크레딧 부여) | 구현 완료 |
| Analysis (RAG 인덱싱/일관성 체크) | 구현 완료 |

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
- 설명: `SCHEMA.md`
- 마이그레이션: 실행 완료 (dev DB 테이블 생성)

### 테스트

- `npm test` 실행으로 현재 테스트 수 확인
- 테스트 전략: `TESTING.md` 참조

### 인프라

| 항목 | 상태 | 비고 |
|------|------|------|
| Docker | Dockerfile 작성 완료 | 멀티스테이지 빌드 + docker-entrypoint.sh |
| CI/CD | GitHub Actions 설정 완료 | `.github/workflows/` |
| Azure Container Apps | 설정 완료 | 서버 호스팅 |
| Azure Database for PostgreSQL | 설정 완료 | DB |
| Azure Container Registry | 설정 완료 | Docker 이미지 |
| Rate Limiting | 적용 완료 | NestJS Throttler 전면 적용 |

상세: `INFRASTRUCTURE.md` 참조.

---

## 3. 배포 현황

| 환경 | 상태 | URL |
|------|------|-----|
| development | 로컬 (DB 연결 완료) | localhost:3000 |
| inhouse | 미배포 | - |
| production | 미배포 | - |

---

## 4. 다음 단계

- inhouse 환경 배포 (Azure Container Apps)
- Google OAuth 실제 연동 (Client ID 필요)
- PAYAPP 실제 연동 (API 키 필요)
- 크레딧-원화-AI토큰 비용 정밀 계산식 구현
- HTML 파서 (최후순위)

---

## 5. 참조 문서

- `docs/environments.md` — 빌드 환경 (정본)
- `docs/api-contract.md` — API 엔드포인트 명세 (정본)
- `TODO.md` — 남은 작업
- `TESTING.md` — 테스트 전략
- `INFRASTRUCTURE.md` — Azure 구성
