# TODO — grimoire-server

> 남은 작업만 기록한다. 완료 항목은 `CHANGELOG.md` 참조.

---

## 기능 구현

- [ ] HTML 파서 (최후순위)

## 외부 연동 (자격증명 필요)

- [ ] Google OAuth 실제 연동 (Google Cloud Console에서 Client ID 발급 필요)
- [ ] PAYAPP 실제 연동 (API 키 발급 필요)
- [ ] PAYAPP 웹훅 HMAC-SHA256 서명 검증 (PAYAPP 키 발급 후)

## 인프라/배포

- [ ] Cloudflare DNS CNAME 레코드 설정 (`INFRASTRUCTURE.md` §10 참조)

## 장기 (운영 규모에 따라 판단)

- [ ] Redis 캐시 (인기 소설 테마 DB 호출 캐싱) — 트래픽 증가 시 도입
- [ ] Container Apps max-replicas 증가 (현재 1 — 수평 확장 불가)
- [ ] DB 데드락 방지 (optimistic locking — 동시 좋아요/크레딧 경합)
- [ ] 관리자 행위 감사 로그 (audit log)
- [ ] WAF (Web Application Firewall) 검토
- [ ] 크레딧-원화-AI토큰 비용 정밀 계산식 구현 (`PLANNING_GRIMOIRE.md` §0 참조)

## 참조

- 전체 API 명세: `docs/api-contract.md`
- 구현 현황: `TECH_STATUS.md`
- 기획서: 루트 `PLANNING_GRIMOIRE.md`
