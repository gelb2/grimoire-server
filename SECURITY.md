# SECURITY.md — grimoire-server

> 보안 정책 + 배포 전 체크리스트.

---

## 1. 환경변수 보안

| 변수 | 민감도 | 관리 방식 |
|------|--------|----------|
| DATABASE_URL | 높음 | Azure Key Vault / GitHub Secrets |
| ANTHROPIC_API_KEY | 높음 | Azure Key Vault / GitHub Secrets |
| CORS_ORIGIN | 중간 | 환경별 설정 |

- `.env` 파일은 `.gitignore`에 포함 (절대 커밋 금지)
- `.env.example`만 커밋 (실제 값 미포함)

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

### 인증 (Phase 3)
- OAuth 2.0 (Kakao/Google)
- JWT 토큰 기반 인증 미들웨어
- Phase 1~2에서는 인증 없음 (공개 API)

---

## 3. 데이터 보안

### 크레딧 시스템
- 크레딧 차감: Prisma 트랜잭션으로 원자적 처리
- 잔액 음수 방지: 트랜잭션 내 체크 + 에러 throw
- credit_logs: INSERT only (수정/삭제 불가 — 감사 로그)

### 재가입 방지
- signup_history: OAuth provider ID로 추적
- 재가입 시 보너스 크레딧 미지급

---

## 4. 배포 전 체크리스트

### 서버

- [ ] `npm test` 전부 통과
- [ ] `npm run build` 성공
- [ ] `docker build` 성공
- [ ] 환경변수 설정 확인 (DATABASE_URL, ANTHROPIC_API_KEY)
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
- 루트 `CLAUDE.md` §7 — 빌드 환경
