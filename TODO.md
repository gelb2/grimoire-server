# TODO — grimoire-server

> 남은 작업만 기록한다. 완료 항목은 `CHANGELOG.md` 참조.

---

## 단기

### 테스트
- [ ] UseCase 테스트 3건 미작성 (chat, plan, theme-slot)

### 외부 연동
- [ ] Polar KYC + 한국 payout 승인 (Polar support 요청) — 실제 카드 결제 활성화 전제
- [ ] 운영 webhook endpoint auto-disable 복구 플로우

### 보안
- [ ] CORS_ORIGIN 누락 시 명시적 에러 또는 localhost 폴백

## 중기 (Phase 2)

- [ ] A24식 Artifacts 데이터 모델 (DB 스키마 설계)
- [ ] 관리자 P1 기능 (대시보드 차트, 공지/알림, 큐레이션, 벌크 작업)

## 장기

- [ ] Redis 캐시 (인기 소설 테마 DB 호출 캐싱)
- [ ] Container Apps max-replicas 증가
- [ ] 크레딧-원화-AI토큰 비용 정밀 계산식
- [ ] HTML 파서 (최후순위)
- [ ] 관리자 P2 기능 (수익 대시보드, 작가 인증, 테마 프리셋 관리)

## 참조

- 전체 API 명세: `docs/api-contract.md`
- 구현 현황: `TECH_STATUS.md`
- 기획서: 루트 `PLANNING_GRIMOIRE.md`
