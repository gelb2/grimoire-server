# TODO — grimoire-server

> 남은 작업만 기록한다. 완료 항목은 `CHANGELOG.md` 참조.

---

## 인프라/배포

- [ ] inhouse 환경 배포 (Azure Container Apps)
- [ ] production 환경 배포
- [ ] Cloudflare DNS CNAME 레코드 설정 (`INFRASTRUCTURE.md` §10 참조)

## 외부 연동

- [ ] Google OAuth 실제 연동 (Google Cloud Console에서 Client ID 발급 필요)
- [ ] PAYAPP 실제 연동 (API 키 발급 필요)

## 기능 구현

- [ ] 크레딧-원화-AI토큰 비용 정밀 계산식 구현 (`PLANNING_GRIMOIRE.md` §0 참조)
- [ ] API 응답 페이지네이션
- [ ] 조회수 통계 집계 로직
- [ ] HTML 파서 (최후순위)

## 보안

- [ ] admin guard 구현 (현재 JWT만 확인, 관리자 역할 미검증)
- [ ] PAYAPP 웹훅 HMAC-SHA256 서명 검증 실제 연동

## 참조

- 전체 API 명세: `docs/api-contract.md`
- 구현 현황: `TECH_STATUS.md`
- 기획서: 루트 `PLANNING_GRIMOIRE.md`

---

## 운영 안정성 — 배포 후 논의 필요

### 1. 트래픽 폭주 대응
- **현재:** @nestjs/throttler 적용 (글로벌 rate limit). Container Apps min-replicas: 0, max: 1.
- **미비:** max-replicas 1이라 수평 확장 불가. CDN/테마 Baking 파이프라인 미구축. 인기 소설 테마 DB 호출 캐싱 없음.
- **필요:** Redis 캐시 또는 테마 Baking (CSS 파일 생성 → CDN), max-replicas 증가, 로드 테스트.

### 2. DB 데드락
- **현재:** 결제 웹훅 $transaction으로 원자성 보장. 단일 트랜잭션 내 3개 작업 (Payment + Credit + CreditLog).
- **미비:** 동시 좋아요 토글 (Like toggle) 시 unique constraint 경합 가능. 동시 크레딧 차감 시 race condition 가능.
- **필요:** SELECT ... FOR UPDATE 또는 optimistic locking 검토. 크레딧 차감 시 isolation level 확인.

### 3. 해킹 대응
- **현재:** HttpOnly Cookie + Secure + SameSite=Strict. AdminGuard role 체크. CSS 인젝션 방어. 댓글 XSS 방어. JWT 시크릿 프로덕션 필수. 결제 웹훅 시크릿 필수.
- **미비:** 브루트포스 로그인 방어 없음 (rate limit은 있지만 계정별 잠금 없음). IP 기반 차단 없음. 감사 로그(audit log) 없음.
- **필요:** 계정 잠금 정책 (5회 실패 → 30분 잠금). 관리자 행위 감사 로그. WAF(Web Application Firewall) 검토.
