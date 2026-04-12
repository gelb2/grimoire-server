# TODO — grimoire-server

> 남은 작업만 기록한다. 완료 항목은 `CHANGELOG.md` 참조.

---

## 단기

### 외부 연동
- [ ] Polar KYC + 한국 payout 승인 (사용자 액션)

### 보안 (2026-04-12 전수검사 → 수정 완료)
- [ ] 🟡 Refresh Token 구현 — 현재 7일짜리 Access Token만 운용
- [ ] npm audit fix (11건: 3 moderate, 8 high — multer DoS, path-to-regexp ReDoS)
- [ ] ExceptionFilter 구현 — prod 환경 스택 트레이스 노출 방지 확인
- [ ] 📄 SECURITY.md가 개발 사이클에서 실제 참조되는지 CLAUDE.md 참조 관계 확인

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
