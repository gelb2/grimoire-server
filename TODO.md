# TODO — grimoire-server

> 남은 작업만 기록한다. 완료 항목은 `CHANGELOG.md` 참조.

---

## 단기

### 외부 연동
- [ ] Polar KYC + 한국 payout 승인 (사용자 액션)

### 보안
- [ ] 🟡 Refresh Token 구현 — 현재 7일짜리 Access Token만 운용
- [ ] npm audit --force (NestJS 10→11 메이저 업그레이드 필요, 21건 잔존)

## 중기 (Phase 2)

- [ ] A24식 Artifacts 데이터 모델

## 장기

- [ ] Redis 캐시 (인기 소설 테마 DB 호출 캐싱)
- [ ] Container Apps max-replicas 증가
- [ ] AI 채팅 스트리밍 (SSE)
- [ ] Kakao OAuth
- [ ] HTML 파서 (최후순위)

## 참조

- 전체 API 명세: `docs/api-contract.md`
- 구현 현황: `TECH_STATUS.md`
- 기획서: 루트 `PLANNING_GRIMOIRE.md`
