# HANDOVER — 2026-04-25 → 다음 세션

> **작성자**: 2026-04-25 로컬 세션 (Claude Opus 4.7 1M)
> **수신자**: 다음 리모트/로컬 세션 (Claude 또는 Codex 등)
> **스냅샷 시점**: 2026-04-25 06:xx KST 기준, 양쪽 레포 `develop` 기준
> **주의**: 이 문서는 시점 스냅샷입니다. 재작성되지 않으면 stale 됩니다. 첫 5분 읽기 이후엔 `git log --oneline -20 && cat TODO.md`로 현재 상태 재검증 필수.

---

## 0.5. 2026-04-25 세션 요약 (가장 최신)

### Harness Engineering Phase 1 P0 구현 완료

이번 세션 목표: `prompt-engineering/prompt-harness-phase1-p0-implementation.md` 프롬프트 실행. 2026-04-19 세션 실수 4건(TCC 헛소리, fetch aborted 추측, 환불 UI 거짓말, Chrome 조기 포기)을 시스템적으로 차단하는 skill + hook 배치.

**산출물**
- `.claude/skills/macos-tcc-handling/SKILL.md` — Docker credsStore=desktop → osxkeychain. "매번 허용" 답변 금지 프로토콜
- `.claude/skills/production-bug-triage/SKILL.md` — fetch aborted 등 증상 보고 시 Chain-of-Verification 3단계 (curl → 코드 → 수치)
- `.claude/skills/claude-in-chrome-recovery/SKILL.md` — Chrome MCP not connected 시 최소 3회 재시도 + javascript_tool 확인
- `.claude/scripts/post-edit-tsc.sh` — Edit/Write 후 `.ts/.tsx/.cts/.mts`면 해당 레포 `tsc --noEmit` 자동. stdin JSON + 인자 fallback 양쪽 지원. tsc 실패 시 stderr 20줄만 출력, exit 0 유지
- `.claude/settings.json` — PostToolUse hook 추가 (matcher=Edit|Write, timeout=60). 기존 4 hook (SessionStart/Stop/UserPromptSubmit/PreCompact) 보존

**실측 발견**
- `grimoire-web/.githooks/pre-push`는 **이미 존재** (2026-04-17 이식 완료 상태). 프롬프트가 "신설 필요"로 가정했으나 실측은 422 bytes 4단계 완성본. 이번 세션에서는 검증만 수행
- grimoire-web이 `main` 브랜치로 check-out되어 있었음 → develop으로 전환

**검증**
- grimoire-qa 서브에이전트 독립 검증 5/5 PASS
  1. Skills 3종 frontmatter 유효 + 증상어 포함 ✅
  2. post-edit-tsc.sh 실행권한 + 4종 동작 ✅
  3. settings.json 5 hook + 기존 4 보존 ✅
  4. grimoire-web pre-push 완전 설정 ✅
  5. grimoire-web develop 브랜치 청결 ✅

**후속 작업**
- 상세 리포트는 `grimoire-server/PROGRESS_HARNESS_P0.md`
- 다음 단계 Phase 1 P1 (Skills 추가 + Slash commands + db-sync 예외)은 TODO.md §단기 참조

---

## 0.6. 2026-04-19 세션 (직전)

---

## 0. 절대 수칙 (읽지 않고 건너뛰면 작업 거절됨)

루트 `CLAUDE.md` §0 **ZERO-TOLERANCE & LETHAL PENALTY PROTOCOL**. 요약:
- **상태 추정 금지** — DB/API 상태를 "추정"해서 보고 금지. curl/psql 실측 필수.
- **정책·PRD 강제 종속** — 새 UI/기능은 기존 권한·보안·정책을 누락 없이 준수.
- **위반 시 사용자 구독 해지 + Codex 전환 예고**.

루트 `CLAUDE.md` §12 **세션 종료 시 메모리 기록 절대 규칙** — `memory/project_session_YYYYMMDD[_N].md` 필수 작성.

---

## 1. 이번 세션 요약 (2026-04-19)

### 해결된 3대 이슈

| 이슈 | 근본 원인 | 해결 |
|---|---|---|
| **explore "작품을 불러올 수 없습니다"** | rawFetch 브라우저 타임아웃 10s + Azure Container Apps cold start 최대 60s | 타임아웃 15s + warm-up ping + 재시도 4×2.5s (`project_session_20260419_3.md`) |
| **AI 일관성 분석 "fetch aborted"** | 프론트 60s 타임아웃 부족 + BFF signal 미전파 + NestJS abort 미감지 | 프론트 120s + BFF `request.signal` 전파 + 서버 `abortableRace` 래퍼로 환불 보장 (`project_session_20260419_4.md`) |
| **dev 로그인 불가** | `db-sync --mask-pii`가 **모든 계정 비번을 고정 해시(`masked2026`)로 교체**. `deerdevil@grimoire.app` 이메일은 `author-3@masked.local`로 치환됨 | 임시: dev DB에서 deerdevil 계정만 수동 UPDATE로 복원. 근본 해결은 TODO |

### 배포 상태 (2026-04-19 22:00 기준)

| 환경 | server 이미지 | web 이미지 |
|---|---|---|
| dev | `dev-61eb14c...` (abort 환불 보장 포함) | `dev-84923ba...` (문구 정직화까지) |
| prod | `prod-f07d633...` | `prod-f72e6d6...` |

양쪽 환경 curl 실측:
- dev/prod `/api/health` 200
- prod 실제 AI 분석 실행 ✅ (크레딧 12→9, fetch aborted 재현 안 됨, 결과 3종 반환)

### 이번 세션 산출물

- server 커밋: `8de95e5` (Docker credsStore 문서) → `4d38e0b` (abort 환불) → `9fa7213` (harness TODO) → `7415f8c` (harness 리서치 문서)
- web 커밋: `d40c458` (DEPLOY 동기화) → `8fc53f4` (fetch aborted 수정) → `84923ba` (UI 문구 정직화) → `06eed28` (harness TODO)
- 신규 메모리: `feedback_docker_credstore.md`, `project_analysis_refund_gap.md`, `project_session_20260419_3.md`, `project_session_20260419_4.md`
- 신규 문서: `research/HARNESS_ENGINEERING.md` (정본: 루트 workspace, grimoire-claude-docs repo), `docs/DEPLOY.md §3` (로컬 머신 세팅), `INFRASTRUCTURE.md §12.2`

### 세션 중 발견한 제 실수 4건 (재발 방지용)

다음 세션이 반드시 회피할 함정:

1. **"매번 허용 누르세요" TCC 헛소리**: Docker Desktop 4.x 기본 `credsStore: "desktop"` 때문에 `az acr login` 시 `python3.13` TCC 다이얼로그. 해결은 `osxkeychain`으로 변경. 대응 정본 → `feedback_docker_credstore.md` + `docs/DEPLOY.md §3.1`.
2. **fetch aborted 원인 추측**: 타임아웃 수치만 보고 "cold start"로 단정하지 말 것. 실측 경로는 curl → 코드 추적 → 네트워크 로그.
3. **환불 UI 문구 거짓말**: "자동 환불" 문구 추가 시 반드시 서버 usecase catch 블록 실존 확인. `grimoire-server/src/application/analysis/novel-analysis.usecase.ts:79-97`에 실제 있지만 **HTTP abort 후 서버 성공 케이스는 환불 안 됨** → abortableRace로 보완 완료 (2026-04-19).
4. **Chrome extension 조기 포기**: `tabs_context_mcp`가 "not connected" 반환해도 한 번 더 재시도로 회복되는 경우 많음. 2회 이상 시도 후 판단.

---

## 2. 남은 과제 (TODO.md 기반)

**마스터**: `grimoire-server/TODO.md`  
**보조**: `grimoire-web/TODO.md`

### 단기 P0 (즉시)

- [ ] **grimoire-web pre-push hook 설치** — `.githooks/pre-push` (server에는 있으나 web 없음). tsc + vitest + build + docs 동기화.
- [ ] **PostToolUse hook** (`.claude/settings.json`) — Edit/Write 후 `.ts`/`.tsx` 수정이면 `npx tsc --noEmit` 자동.
- [ ] **로그인 페이지 테스트 계정 하드코딩 교체** — `grimoire-web/src/app/login/page.tsx`의 `test@grimoire.app`은 dev DB에 없음. 실측된 dev 계정 slug으로 교체 또는 버튼 비활성화.

### 단기 P1 (Skills)

- [ ] `.claude/skills/macos-tcc-handling.md` — `feedback_docker_credstore.md` 승격. TCC 증상 시 "매번 허용" 답변 금지.
- [ ] `.claude/skills/production-bug-triage.md` — curl 실측 → 코드 추적 → 추정 금지.
- [ ] `.claude/skills/claude-in-chrome-recovery.md` — extension 미연결 시 3회 재시도.

### 중기 P2 (Slash commands + db-sync 근본 해결)

- [ ] `/dev-login-smoke` — `db-sync --mask-pii` 회귀 감지. dev에 deerdevil 실계정 시드 유지.
- [ ] `/deploy-precheck` — preflight 호출 전 양쪽 레포 git 정합성.
- [ ] `/refund-logic-audit` — "자동 환불" UI 문구 추가 시 서버 catch 블록 존재 매칭.
- [ ] **db-sync.ts에 "admin/test 계정 마스킹 예외" 옵션** — 현재 전 계정 비번을 고정 해시로 덮어씀. dev 로그인 테스트 불가의 근본 원인.

### 중기 (F2/F3 본 기획)

- [ ] AI 채팅 1턴 크레딧 차감 연동
- [ ] 모델 티어링 — Haiku 4.5로 FAQ 라우팅
- [ ] 커스텀 테마 에디터 Color Picker 고도화
- [ ] 작품별 테마 배정 UI (api.ts에 메서드 있으나 대시보드 UI 없음)
- [ ] A24식 Artifacts 데이터 모델 + UI

### 장기 P3

- [ ] `.mcp.json` — Polar 크레딧, Azure Container App 도메인 특화 MCP
- [ ] `PreToolUse` hook — main 직접 push 경고, 위험 명령 차단
- [ ] CLAUDE.md §14 실측 반영 (sensors/knowledge "미도입" 표기 vs 실제 도입 불일치)
- [ ] Claude SDK / OpenAI SDK signal 전파 — 서버 abort 시 실제 API 호출도 cancel (현재는 환불만 보장, 토큰 비용은 백그라운드에서 지출됨)
- [ ] Redis 캐시, SSE, Kakao OAuth, HTML/PDF 파서

### 외부 의존 (사용자 액션)

- [ ] Polar KYC + 한국 payout 승인
- [ ] Polar webhook inhouse endpoint 수동 삭제
- [ ] 4월 12일 이후 조회수 급락 조사 (실측 데이터 필요)

---

## 3. Harness Engineering 리서치 요약

> 상세: `research/HARNESS_ENGINEERING.md` (정본: 루트 workspace, grimoire-claude-docs repo) (커밋 `7415f8c`)

### 정의 (Martin Fowler)
"Everything in an AI agent except the model itself" — 모델 주변을 **가이드(feedforward)**와 **센서(feedback)**로 조이는 사용자 구축 시스템.

### 4축

| 축 | 역할 | ProjectGrimoire 예시 |
|---|---|---|
| Guides (feedforward) | 행동 전에 방향 제시 | CLAUDE.md §0, PLANNING_GRIMOIRE.md, docs/ 정본 |
| Sensors (feedback) | 행동 후 이상 신호 | `.claude/scripts/sensor-*.sh`, pre-push, 테스트 |
| Computational | 결정적·빠름 | tsc, vitest, jest, eslint |
| Inferential | 의미 기반·느림 | 서브에이전트 7종 |

### 핵심 원리 5

- **Shift Left** — 가장 싼 단계에서 최대한 막기 (Edit 직후 > pre-push > CI > 배포)
- **Steering Loop** — 반복 문제 발견 시 harness 자체를 진화
- **Requisite Variety** — 규제자는 규제 대상만큼의 다양성 필요
- **Harnessability** — TypeScript strict + Hexagonal + FSD는 ProjectGrimoire의 큰 자산
- **Ambient Affordances** — 구조가 에이전트에 "legible, navigable, tractable"해야

### 경계할 실패 모드 6

1. Feedback-only (같은 실수 반복) — 이번 세션 TCC 헛소리
2. Feedforward-only (규칙만 많고 검증 없음) — 환불 UI 거짓말
3. Over-reliance on AI-generated tests
4. Silent sensors (한 번도 안 울리면 감지 불가)
5. Harness drift (문서와 실측 불일치) — CLAUDE.md §14 이슈
6. 3 unsolved (misdiagnosis, overengineering, misunderstood instructions)

### ProjectGrimoire 대조

| 상태 | 도입된 것 |
|---|---|
| ✅ | Sub-agents 7개, Sensors 4개, Memory hooks 4종, 정본 문서 피라미드, server pre-push |
| ❌ | **PostToolUse/PreToolUse hooks, Skills, Slash commands, web pre-push, `.mcp.json`** |

### 채택 권장 (TODO §2와 1:1 연동)

- P0: web pre-push + PostToolUse tsc auto
- P1: Skills 3종 (TCC / bug-triage / chrome-recovery)
- P2: slash commands + db-sync 예외
- P3: MCP + PreToolUse + 문서 현행화

### 커뮤니티 리소스

- [Fowler 원문](https://martinfowler.com/articles/harness-engineering.html) — 이론 정본
- [Reddit /r/ClaudeAI 1s9jm0d](https://www.reddit.com/r/ClaudeAI/comments/1s9jm0d/i_had_claude_read_every_harness_engineering_guide/) (fetch 제한)
- [Claude Code Skills 공식](https://code.claude.com/docs/en/skills)
- [Chachamaru127/claude-code-harness](https://github.com/Chachamaru127/claude-code-harness) — Go guardrail + 5 verb skills
- [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code) — ECC 번들 (커뮤니티 논란)
- [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) — 큐레이트 목록
- [Paradime 가이드](https://www.paradime.io/guides/claude-code-skills-plugins-rules-guide)
- [David R Oliver starter kit](https://medium.com/@davidroliver/skills-and-hooks-starter-kit-for-claude-code-c867af2ace32)

---

## 4. 함정 목록 (다음 세션이 재현하지 말 것)

| 함정 | 증상 | 회피 |
|---|---|---|
| Docker `credsStore: "desktop"` | `make deploy-*` 중 `python3.13` TCC 다이얼로그 반복 | `~/.docker/config.json`의 `credsStore`를 `osxkeychain`으로. 상세: `feedback_docker_credstore.md` |
| dev DB PII 마스킹 | 실 이메일로 로그인 불가 (`deerdevil@grimoire.app`은 dev에서 `author-3@masked.local`로 치환). 전 계정 비번은 `masked2026` | `scripts/db-sync.ts:21,36-42` — 수동 UPDATE로 복원 가능하지만 다음 db-sync에서 덮어써짐. 근본: TODO의 "admin 마스킹 예외" 도입 |
| reCAPTCHA 필수 | curl 직접 `/api/auth/login` 호출 시 400 "reCAPTCHA 토큰 필요" | 로그인은 브라우저에서만. curl 검증은 `/api/health` 등 공개 엔드포인트로 |
| prod cold start 최대 60초 | BFF 로그인 15s 타임아웃 후 "signal timed out" | API warm-up ping 먼저 돌리거나 10초 후 재시도 |
| `make deploy-prod` SKIP_INTERACTIVE | 인터랙티브 확인 없이 prod 배포 | 사용자 명시 지시 없이 설정하지 말 것. 현재 세션은 "다 해결해" 지시로 사용 |
| main 직접 커밋 금지 (CLAUDE.md §8) | — | 반드시 develop에서 머지. feature/bugfix 브랜치 경유 |
| Chrome-in-extension 연결 실패 | "not connected" 1회 | 2~3회 재시도 후 판단 |

---

## 5. 첫 5분 읽기 리스트

다음 세션 시작 시 순서대로:

1. 루트 `CLAUDE.md` §0 (절대 수칙), §12 (메모리 기록), §14 (에이전트 구조)
2. `grimoire-server/TODO.md` "Claude Code harness 강화" 섹션 ← 최근 갱신
3. `research/HARNESS_ENGINEERING.md` (정본: 루트 workspace, grimoire-claude-docs repo) — 이번 세션 리서치 산출물
4. `memory/MEMORY.md` 인덱스 — 특히 `project_session_20260419_*.md` 최신 4개
5. `memory/feedback_docker_credstore.md` — TCC 대응
6. `grimoire-server/docs/DEPLOY.md §3` — 로컬 머신 세팅

현재 상태 재검증 명령:
```bash
cd /Users/sokol/Desktop/Git/ProjectGrimoire
(cd grimoire-server && git log --oneline -10) && echo "---" && (cd grimoire-web && git log --oneline -10)
curl -s -o /dev/null -w "prod web %{http_code} %{time_total}s\n" https://grimoire-book.com/
curl -s -o /dev/null -w "prod api %{http_code} %{time_total}s\n" https://api.grimoire-book.com/api/health
curl -s -o /dev/null -w "dev web %{http_code} %{time_total}s\n" https://dev.grimoire-book.com/
curl -s -o /dev/null -w "dev api %{http_code} %{time_total}s\n" https://dev-api.grimoire-book.com/api/health
```

---

## 6. 검증 명령 치트시트

```bash
# 양쪽 레포 유닛 테스트
cd grimoire-server && npm test
cd grimoire-web && npm test -- --run

# 타입 체크
cd grimoire-server && npx tsc --noEmit
cd grimoire-web && npx tsc --noEmit

# 배포 (prod TCC 이슈 없는 상태에서만)
cd grimoire-server && SKIP_INTERACTIVE=1 make deploy-dev
cd grimoire-server && SKIP_INTERACTIVE=1 make deploy-prod
cd grimoire-web && SKIP_INTERACTIVE=1 make deploy-dev
cd grimoire-web && SKIP_INTERACTIVE=1 make deploy-prod

# dev DB 진단 (deerdevil 계정 상태 확인)
MY_IP=$(curl -s ifconfig.me)
az postgres flexible-server firewall-rule create \
  --resource-group zenith-rg --name grimoire-db-dev \
  --rule-name debug-$(date +%s) \
  --start-ip-address "$MY_IP" --end-ip-address "$MY_IP" --output none
PGPASSWORD="REMOVED_CREDENTIAL_015" psql \
  -h grimoire-db-dev.postgres.database.azure.com \
  -U grimoireadmin -d grimoire \
  -c "SELECT email, slug, name FROM authors WHERE slug = 'deerdevil';"
# DEV_DB_PW 값은 ACCOUNTS.md (로컬 vault, .gitignore) 참조
# 작업 끝나면 방화벽 규칙 제거 필수:
# az postgres flexible-server firewall-rule delete -g zenith-rg -n grimoire-db-dev --rule-name debug-... --yes
```

---

## 7. 마지막 한 줄

**사용자는 추측 보고를 극도로 싫어합니다. curl/psql/git 실측 없이 "아마도"라고 말하면 안 됩니다. 이 세션 초반에 제가 그 실수로 사용자 격분을 여러 번 유발했습니다 (TCC, fetch aborted, db-sync).** 다음 세션은 반드시 실측부터.
