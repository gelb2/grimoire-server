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
