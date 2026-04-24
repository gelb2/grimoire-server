# TODO — grimoire-server

> 남은 작업만 기록한다. 완료 항목은 `CHANGELOG.md` 참조.

---

## 단기

### 외부 연동
- [ ] Polar KYC + 한국 payout 승인 (사용자 액션)

### Claude Code harness 강화 (2026-04-19 도입 필요 — 루트 `.claude/` 작업, 실제 실수 재발 방지용)

> 실측 대비 현황: `.claude/settings.json`에 SessionStart/Stop/UserPromptSubmit/PreCompact 4개 hook만 있고 전부 "메모리 파일 관리"에 치우침. 편집 직후 강제 검증 축이 전면 부재. 이번 2026-04-19 세션에서 실제 발생한 실수(TCC 헛소리, fetch aborted 추측, 환불 UI 거짓 문구, Chrome extension 조기 포기)를 시스템적으로 막는 장치가 없어서 매 세션 재발 가능.

**P0 (즉시)**
- [ ] `grimoire-web/.githooks/pre-push` 설치 — server는 있으나 web 없음. tsc + vitest + build + docs 동기화 검증
- [ ] 루트 `.claude/settings.json`에 `PostToolUse` hook 추가 — Edit/Write 후 변경 파일이 `.ts`/`.tsx`면 해당 레포 `npx tsc --noEmit` 자동 실행

**P1 — Skills 3종 (`.claude/skills/`)**
- [ ] `macos-tcc-handling.md` — "매번 허용" 답변 금지 + osxkeychain 검증 프로토콜 (feedback_docker_credstore.md를 skill로 승격)
- [ ] `production-bug-triage.md` — curl 실측 → 코드 경로 추적 → 추정 금지 (feedback_fullcheck_method.md를 skill로 승격)
- [ ] `claude-in-chrome-recovery.md` — extension 미연결 시 3회 재시도 + navigate 지연 대응

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
- [ ] `grimoire-web/src/app/login/page.tsx`의 "테스트 계정으로 채우기" 하드코딩 이메일 `test@grimoire.app`이 dev DB에 없음 → dev 실존 계정으로 교체

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
