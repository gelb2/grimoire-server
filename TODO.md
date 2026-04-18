# TODO — grimoire-server

> 남은 작업만 기록한다. 완료 항목은 `CHANGELOG.md` 참조.

---

## 단기

### 외부 연동
- [ ] Polar KYC + 한국 payout 승인 (사용자 액션)

## 중기 (Phase 2)

- [ ] A24식 Artifacts 데이터 모델
- [ ] `reuploadEpisode` — input.title 없을 때 `meta?.subtitle`을 title로 쓰는 폴백 버그 수정 (title-normalization-pipeline PR 범위 밖으로 분리됨)
- [ ] 서버 파서가 frontmatter.title을 meta에 포함시키도록 계층 정리 (현재 웹에서만 frontmatter.title 읽음 — Hexagonal 관점 계층 꼬임)

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
