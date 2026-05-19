# TODO — grimoire-server

> 남은 작업만 기록한다. 완료 항목은 `CHANGELOG.md` 참조.

---

## 단기

### 외부 연동
- [ ] Polar KYC + 한국 payout 승인 (사용자 액션)
- [ ] Polar Dashboard 에 입문 패키지(`POLAR_PRODUCT_STARTER` $2.99) 상품 등록 — CC-2a 디노미 4종 신설분 (사용자/infra 액션). 등록 전까지 입문 패키지 결제는 `resolvePolarProductId` null → 매핑 실패

### 크레딧 개편 후속 (CC-2a 완료 — CHANGELOG [0.37.0] 참조)
- [ ] **CC-2b** — 선물(T4) / 환불(T7) 적립을 신 `CreditLedger` 원장으로 이행. CC-2a 案 1 패턴(도메인 헬퍼 + Repository 단일 `$transaction`) 재사용. 환불은 이중 외상(`RefundLog.deficitCredits` ↔ `Author.deficitPoints`) 통합. 정본: `reports/CREDIT_CORE_DIAGNOSIS.md` §1-B·§1-C·§8
- [ ] **CC-2b 후** — `completePaymentAtomically` 구 메서드 제거 (`@deprecated` 상태, 호출처 0건). `Payment.credits` 컬럼 물리 rename(`credits`→`points`) — 마이그레이션 동반 (MEDIUM-4)
- [ ] CC-3(이월 금지 + 원장 단일화) / CC-4(V Phase 마이그레이션 적용) / CC-5(PAY-P1-4 Polar 구독) — `reports/CREDIT_CORE_DIAGNOSIS.md` §8 sprint 분할표

### Claude Code harness 강화 (2026-04-19 도입 — 루트 `.claude/` 작업, 실제 실수 재발 방지용)

> 실측 대비 현황: 2026-04-25 세션에서 Phase 1 P0 구현 완료 (Skills 3종, PostToolUse hook, post-edit-tsc.sh, grimoire-web pre-push 검증). 편집 직후 tsc 자동 + 재발 방지 skill 3종 배치 완료. 세부 리포트는 `grimoire-server/PROGRESS_HARNESS_P0.md` 참조.

**P0 (완료 — 2026-04-25)**
- [x] `grimoire-web/.githooks/pre-push` 설치 확인 — 실제로는 2026-04-17에 이미 이식 완료 상태 (422 bytes, 4단계 tsc/test/build/docs). 2026-04-25 세션에서 검증 PASS
- [x] 루트 `.claude/settings.json`에 `PostToolUse` hook 추가 — Edit/Write 후 `.ts/.tsx/.cts/.mts` 편집 시 해당 레포 `npx tsc --noEmit` 자동. `/Users/sokol/Desktop/Git/ProjectGrimoire/.claude/scripts/post-edit-tsc.sh`가 경로 기반 레포 자동 감지. 기존 4 hook 보존

**P1 — Skills 3종 (`.claude/skills/`) — 완료 (2026-04-25)**
- [x] `.claude/skills/macos-tcc-handling/SKILL.md` — "매번 허용" 답변 금지 + osxkeychain 검증 프로토콜 (feedback_docker_credstore.md 승격)
- [x] `.claude/skills/production-bug-triage/SKILL.md` — Chain-of-Verification 3단계 (curl → 코드 경로 → 수치 근거). 추정 금지
- [x] `.claude/skills/claude-in-chrome-recovery/SKILL.md` — extension 미연결 시 최소 3회 재시도 + javascript_tool URL 확인 + 새 탭 우회

**P2 — Slash commands (`.claude/commands/`)**
- [ ] `/dev-login-smoke` — db-sync --mask-pii 회귀 감지용 실제 dev 로그인 시도
- [ ] `/deploy-precheck` — preflight 호출 전 양쪽 레포 git status + 브랜치 정합성 자동 점검
- [ ] `/refund-logic-audit` — "자동 환불" 문구 UI 추가 시 서버 usecase catch 블록 존재 확인

**P3**
- [ ] `.mcp.json`으로 도메인 특화 MCP 서버 정의 (예: Polar 크레딧 조회, Azure Container App 상태)
- [ ] `PreToolUse` hook — `git push origin main` 감지 시 경고 + confirm

**문서 현행화**
- [ ] 루트 `CLAUDE.md` §14 "미도입" 목록 실측 반영 — sensor-*.sh, `.claude/knowledge/` 실제 도입됨 vs 문서는 "미도입"으로 박제됨. `TASK_QUEUE.json`, `AUTOMATION.md`만 진짜 미도입
- [ ] db-sync.ts에 "admin/test 계정 마스킹 예외" 옵션 추가 — 현재는 전 계정 비번을 고정 해시로 덮어써서 dev 로그인 테스트 불가 (2026-04-19 세션에서 수동으로 deerdevil만 복원)
- [x] **해소 (2026-05-04 EMAIL-P0-1)** — `grimoire-web/src/app/login/page.tsx`에서 "테스트 계정으로 채우기" 버튼 자체 이미 제거 확인. e2e/auth.spec.ts의 broken 테스트도 본 sprint에서 삭제. 시드 스크립트 도메인 `@grimoire.app` → `@example.com` 일괄 치환 (RFC 2606). 운영 DB 12~15 row 정리는 사용자 영역 (EMAIL-P0-2 SQL).

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
