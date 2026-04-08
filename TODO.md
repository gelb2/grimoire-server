# TODO — grimoire-server

> 남은 작업만 기록한다. 완료 항목은 `CHANGELOG.md` 참조.

---

## 단기 (Phase 1 마무리)

### 보안
- [x] ~~IDOR: dto.authorId 제거, Controller는 req.user.sub 사용~~ (v0.20.0)
- [x] ~~크레딧 Race Condition: adjustCredits $transaction 원자화~~ (v0.20.0)
- [x] ~~HWPX Zip Bomb: 50MB 제한~~ (이미 구현됨 + 테스트 추가 v0.20.0)
- [x] ~~DOCX 크기 제한: mammoth 출력 50MB 제한~~ (v0.20.0)
- [ ] CORS_ORIGIN 누락 시 명시적 에러 또는 localhost 폴백

### 외부 연동
- [ ] 결제 게이트웨이 실제 연동 (PayApp or Polar — API 키 발급 필요)
- [ ] 결제 웹훅 서명 검증 (키 발급 후)

## 중기 (Phase 2)

- [ ] A24식 Artifacts 데이터 모델 (DB 스키마 설계)

## 장기 (운영 규모에 따라 판단)

- [ ] Redis 캐시 (인기 소설 테마 DB 호출 캐싱) — 트래픽 증가 시 도입
- [ ] Container Apps max-replicas 증가 (현재 1 — 수평 확장 불가)
- [ ] DB 데드락 방지 (optimistic locking — 동시 좋아요/크레딧 경합)
- [ ] 관리자 행위 감사 로그 (audit log)
- [ ] 크레딧-원화-AI토큰 비용 정밀 계산식

## 참조

- 전체 API 명세: `docs/api-contract.md`
- 구현 현황: `TECH_STATUS.md`
- 기획서: 루트 `PLANNING_GRIMOIRE.md`
