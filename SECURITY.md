# SECURITY.md — grimoire-server

> 보안 정책 + 배포 전 체크리스트.

---

## 1. 환경변수 보안

| 변수 | 민감도 | 관리 방식 |
|------|--------|----------|
| DATABASE_URL | 높음 | Azure Key Vault / GitHub Secrets |
| ANTHROPIC_API_KEY | 높음 (선택적) | Azure Key Vault / GitHub Secrets |
| JWT_SECRET | 높음 | Azure Key Vault / GitHub Secrets |
| CORS_ORIGIN | 중간 | 환경별 설정 |

- `.env` 파일은 `.gitignore`에 포함 (절대 커밋 금지)
- `.env.example`만 커밋 (실제 값 미포함)

> 환경변수 전체 목록: `docs/environments.md` 참조.

---

## 2. API 보안

### CORS
- development: `http://localhost:3001`
- inhouse: `https://inhouse.grimoire.app`
- production: `https://grimoire.app`
- `*` 사용 절대 금지

### 입력 검증
- 모든 엔드포인트: `ValidationPipe` (whitelist + forbidNonWhitelisted)
- DTO 기반 검증: `class-validator` 데코레이터
- transform: true (타입 자동 변환)

### 인증
- JWT 토큰 기반 인증 (`JwtAuthGuard`)
- 이메일/비밀번호 회원가입 + 로그인 (bcryptjs 해싱)
- Google OAuth 로그인 (`POST /api/auth/google`)
- `passwordHash` 필드는 API 응답에서 제외

### Rate Limiting
- NestJS Throttler 전면 적용
- 전체 엔드포인트에 요청 속도 제한

---

## 3. 데이터 보안

### 크레딧 시스템
- 크레딧 차감: Prisma 트랜잭션으로 원자적 처리
- 잔액 음수 방지: 트랜잭션 내 체크 + 에러 throw
- credit_logs: INSERT only (수정/삭제 불가 — 감사 로그)

### 결제 원자성 (Atomicity) — 절대 원칙

> **금융 트랜잭션의 핵심: 전부 성공하거나, 전부 실패하거나. 중간 상태는 존재하지 않는다.**

결제 웹훅 처리 시 아래 3개 작업을 **단일 Prisma `$transaction`** 으로 묶어야 한다:

1. Payment 상태 → `completed` 변경
2. Author 크레딧 잔액 증가 (`{ increment: N }`)
3. CreditLog 기록 생성

**왜 반드시 원자적이어야 하는가:**
- Payment만 completed 되고 크레딧이 안 들어가면 → 사용자가 돈만 낸 상황
- 크레딧만 들어가고 Payment가 pending이면 → 웹훅 재시도 시 크레딧 중복 부여
- 어느 한쪽이라도 실패하면 전체 롤백 → 재시도 가능한 안전한 상태 유지

**관련 코드:**
- `src/application/payment/payment.usecase.ts` — `processWebhook()`
- `src/adapter/outbound/persistence/prisma-credit.repository.ts` — `adjustCredits()`
- `src/application/payment/payment.usecase.spec.ts` — 원자성 검증 테스트

### 결제 보안

- PAYAPP 웹훅: HMAC-SHA256 서명 검증 필수 (`src/adapter/outbound/payment/payapp.adapter.ts`)
- 중복 웹훅 방지: tradeNo 기반 멱등성 (이미 completed면 무시)
- 결제 기록: Payment 테이블에 전부 기록 (감사 추적)
- 결제 시작 → 완료 사이: pending 상태로 추적

### 재가입 방지
- signup_history: OAuth provider ID로 추적
- 재가입 시 보너스 크레딧 미지급

---

## 4. 배포 전 체크리스트

### 서버

- [ ] `npm test` 전부 통과
- [ ] `npm run build` 성공
- [ ] `docker build` 성공
- [ ] 환경변수 설정 확인 (DATABASE_URL, ANTHROPIC_API_KEY, JWT_SECRET)
- [ ] Prisma 마이그레이션 완료
- [ ] API 엔드포인트 응답 확인
- [ ] CORS 설정 확인 (`*` 아닌지)
- [ ] Swagger: production에서 비활성화
- [ ] DB 방화벽 규칙 확인

### 공통

- [ ] 2개 레포 CHANGELOG.md 업데이트
- [ ] 2개 레포 TODO.md 업데이트
- [ ] `docs/` 파일 2개 레포 동기화 확인

---

## 5. 참조 문서

- `INFRASTRUCTURE.md` — Azure 리소스 구성
- `docs/environments.md` — 환경별 설정 (정본)
- 루트 `CLAUDE.md` §11 — 전수검사 체크리스트
