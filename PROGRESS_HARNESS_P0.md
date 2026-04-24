# PROGRESS — Harness Engineering Phase 1 P0

> **작업 시작**: 2026-04-25
> **프롬프트**: `prompt-engineering/prompt-harness-phase1-p0-implementation.md`
> **상위 계획**: `grimoire-server/research/HARNESS_ENGINEERING.md` §10 Phase 1
> **TODO 연결**: `grimoire-server/TODO.md` "Claude Code harness 강화" P0/P1

---

## Phase 0 — 현황 실측 (완료)

### 실측 명령 + 결과

#### 1) `.claude/` 구조
```
.claude/agents/          (7개 agent .md)
.claude/prompts/         (6개 agent 프롬프트 .txt)
.claude/scripts/         (11개 shell, sensor-*.sh + memory-guard)
.claude/knowledge/       (README.md + agent-system.md + sensors.md)
.claude/settings.json    (hooks 4개: SessionStart, Stop, UserPromptSubmit, PreCompact)
.claude/settings.local.json (permissions allow만, hooks 없음)
```
**`.claude/skills/` 디렉토리는 없음** → 이번 작업으로 신설.

#### 2) settings.json 기존 hook (보존 대상)
- SessionStart → `check-memory-freshness.sh`
- Stop → `stop-memory-guard.sh`
- UserPromptSubmit → `user-prompt-memory-check.sh`
- PreCompact → `pre-compact-memory-guard.sh`

PostToolUse/PreToolUse hook 없음 → PostToolUse만 이번 작업에서 추가.

#### 3) grimoire-server 상태
- 브랜치: `develop`
- status: 깨끗
- origin/develop 동기화 OK (0 ahead, 0 behind)
- `.githooks/pre-push` 존재 (475 bytes, 실행권한 O, 5단계 검증: tsc/test/build/prisma/docs)
- `git config core.hooksPath` = `.githooks`

#### 4) grimoire-web 상태 — **실측 발견**
- 브랜치: **`main`** (develop 아님!) — 프롬프트가 가정한 상태와 다름
- status: 깨끗
- main은 origin/develop보다 4커밋 앞섬 (develop→main 머지 2건 포함)
- **`.githooks/pre-push` 이미 존재** (422 bytes, 실행권한 O, 4단계: tsc/test/build/docs)
  - 기존 내용이 프롬프트 STEP 3 사양과 동일 — 이식 이미 완료 상태
- `git config core.hooksPath` = `.githooks`

#### 5) 프롬프트 가정과의 차이
| 항목 | 프롬프트 가정 | 실측 |
|---|---|---|
| grimoire-web pre-push | 없음 (신설 필요) | **이미 존재·완성 상태** |
| grimoire-web 브랜치 | develop | **main** (develop으로 전환 필요) |
| settings.json 4 hook | 있음 | 있음 ✅ |
| skills/ 디렉토리 | 없음 | 없음 ✅ |
| post-edit-tsc.sh | 없음 | 없음 ✅ |

### Phase 0 판정

- [x] `.claude/` 실측
- [x] 기존 4개 hook 식별 (보존 대상)
- [x] 양 레포 git 상태 확인
- [x] grimoire-web pre-push 이식 여부 실측
- [x] 필수 참조 문서 로드 (CLAUDE.md §0/§8/§12, HARNESS_ENGINEERING §6/§9/§10, HANDOVER, TODO, feedback_docker_credstore, feedback_fullcheck_method, 세션 20260419_3/_4)

### 이번 세션 작업 범위 확정

1. Skills 3종 신설 (`macos-tcc-handling`, `production-bug-triage`, `claude-in-chrome-recovery`)
2. `post-edit-tsc.sh` 신설 + settings.json PostToolUse hook 추가 (기존 4 hook 보존)
3. grimoire-web pre-push는 **검증만** (이미 완성 상태)
4. grimoire-qa 서브에이전트 독립 검증
5. 커밋·핸드오프 (grimoire-web develop 경유, grimoire-server HANDOVER/TODO 갱신)

---

## Phase 1 — Skills 3종 설계 (완료)

### 산출물

| Skill | 파일 | 요지 |
|---|---|---|
| macos-tcc-handling | `.claude/skills/macos-tcc-handling/SKILL.md` | `az acr login`/`docker login` 시 python3.13 TCC 다이얼로그 대응. credsStore=desktop → osxkeychain 전환 필수. "매번 허용" 답변 금지 |
| production-bug-triage | `.claude/skills/production-bug-triage/SKILL.md` | fetch aborted / 작품 로드 실패 등 증상 보고 시 Chain-of-Verification 3단계 (curl → 코드 경로 → 수치 근거). 추정 금지 |
| claude-in-chrome-recovery | `.claude/skills/claude-in-chrome-recovery/SKILL.md` | Claude-in-Chrome MCP not connected / 반영 지연 시 최소 3회 재시도 + javascript_tool 검증 + 새 탭 우회 |

### frontmatter 검증
```
$ for f in .claude/skills/*/SKILL.md; do
    echo "=== $f ==="
    awk '/^---$/{i++; next} i==1' "$f" | head -4
  done
```
모두 `name`, `description`, `allowed-tools` 필드 유효. description에 증상어·트리거어 포함 (예: "az acr login", "python3.13", "not connected").

---

## Phase 2 — PostToolUse hook + grimoire-web pre-push (완료)

### post-edit-tsc.sh

- 경로: `/Users/sokol/Desktop/Git/ProjectGrimoire/.claude/scripts/post-edit-tsc.sh`
- 실행 권한: `-rwxr-xr-x` ✅
- stdin JSON 파싱 + $1 인자 fallback 양쪽 지원
- `.ts/.tsx/.cts/.mts` 화이트리스트 외 조용히 exit 0
- grimoire-server/ 또는 grimoire-web/ 경로만 tsc 실행, 그 외 exit 0
- tsc 실패 시 stderr에 마지막 20줄 출력, exit 코드는 0 유지 (Claude 흐름 차단 방지)

스모크 테스트 결과:
- `.md` 파일 → exit 0 조용히 ✅
- 빈 인자 → exit 0 조용히 ✅
- 비-repo .ts 경로 → exit 0 조용히 ✅
- grimoire-server/src/main.ts → tsc 통과 → exit 0 조용히 ✅
- stdin JSON (`{"tool_input":{"file_path":"..."}}`) → 정상 파싱 ✅

### settings.json PostToolUse 추가

기존 4개 hook 보존 상태에서 PostToolUse 추가:
```
hook keys: SessionStart, Stop, UserPromptSubmit, PreCompact, PostToolUse
PostToolUse matcher: Edit|Write
command: bash /Users/sokol/Desktop/Git/ProjectGrimoire/.claude/scripts/post-edit-tsc.sh
timeout: 60
```

JSON 파싱 유효성 확인됨 (Python `json.load` 통과).

### grimoire-web pre-push (이미 존재 → 검증)

- 경로: `grimoire-web/.githooks/pre-push`
- 실행 권한: `-rwxr-xr-x` ✅
- 422 bytes, `set -e` 포함 (실패 시 즉시 차단)
- 4단계 (server와 동일 배너 포맷):
  1. `npx tsc --noEmit`
  2. `npm test`
  3. `npm run build`
  4. `sensor-docs-sync.sh` 호출
- `git config core.hooksPath` = `.githooks` 설정됨
- 참조 스크립트 `.claude/scripts/sensor-docs-sync.sh` 존재 확인

프롬프트 STEP 3이 가정한 "grimoire-web pre-push 없음" 상태는 실제로는 **이미 완전 이식 상태**. 이번 세션에서는 신설 불필요, 검증만 수행.

---

## Phase 3 — grimoire-qa 독립 검증 (완료)

grimoire-qa 서브에이전트가 5개 항목 전부 PASS 판정.

| # | 항목 | PASS/FAIL | 증거 요약 |
|---|---|---|---|
| 1 | Skills 3종 frontmatter | PASS | 3개 파일 모두 name/description 보유. 증상어 포함: "not connected", "python3.13", "Docker credsStore=desktop", "fetch aborted", "작품을 불러올 수 없습니다", "signal timed out" |
| 2 | post-edit-tsc.sh 실행권한 + 동작 | PASS | -rwxr-xr-x, 빈 인자/.md/stdin JSON/실 .ts 4종 전부 exit 0 조용히 |
| 3 | settings.json 5 hook | PASS | SessionStart/Stop/UserPromptSubmit/PreCompact 보존 + PostToolUse 추가. matcher=`Edit\|Write`, timeout=60 |
| 4 | grimoire-web pre-push | PASS | -rwxr-xr-x, set -e, 4단계(tsc/test/build/docs-sync), core.hooksPath=.githooks |
| 5 | grimoire-web 브랜치 | PASS | develop, 작업 트리 청결 |

**종합 판정: PASS**
FAIL 항목: 없음

---

## Phase 4 — 커밋·핸드오프 (진행 중)

### 커밋 정책

- **루트 `.claude/` 변경**: git 관리 대상 아님 (루트는 non-git). 메모리 파일(`memory/project_session_20260425.md`)에 전체 내용 박제
- **grimoire-web 변경**: 이번 세션에서 변경 파일 없음 (pre-push는 이미 완전 이식 상태). 커밋 불필요
- **grimoire-server 커밋**: HANDOVER.md Phase 1 P0 완료 반영 + TODO.md harness 체크박스 + HARNESS_ENGINEERING.md Phase 1 완료 표시 + PROGRESS_HARNESS_P0.md 이 파일 이동

### 산출물 경로 요약

| 분류 | 경로 | 변경 유형 |
|---|---|---|
| Skill | `.claude/skills/macos-tcc-handling/SKILL.md` | 신규 (루트, 비-git) |
| Skill | `.claude/skills/production-bug-triage/SKILL.md` | 신규 (루트, 비-git) |
| Skill | `.claude/skills/claude-in-chrome-recovery/SKILL.md` | 신규 (루트, 비-git) |
| Script | `.claude/scripts/post-edit-tsc.sh` | 신규 (루트, 비-git) |
| Hook | `.claude/settings.json` | 수정 (PostToolUse 추가, 루트 비-git) |
| Doc | `grimoire-server/HANDOVER.md` | 수정 (grimoire-server 커밋) |
| Doc | `grimoire-server/TODO.md` | 수정 (grimoire-server 커밋) |
| Doc | `grimoire-server/research/HARNESS_ENGINEERING.md` | 수정 (grimoire-server 커밋) |
| Doc | `grimoire-server/PROGRESS_HARNESS_P0.md` | 신규 (이 파일 이동) |

### Phase 1 P0 OUTPUT_SPEC 체크리스트

- [x] `.claude/skills/macos-tcc-handling/SKILL.md`
- [x] `.claude/skills/production-bug-triage/SKILL.md`
- [x] `.claude/skills/claude-in-chrome-recovery/SKILL.md`
- [x] `.claude/scripts/post-edit-tsc.sh` (실행 권한 포함)
- [x] `.claude/settings.json` (PostToolUse 추가, 기존 4 hook 보존)
- [x] `grimoire-web/.githooks/pre-push` (실행 권한 포함) — 이미 존재 상태로 검증만
- [x] grimoire-web develop 변경 없음 → 커밋 불필요 (원래 프롬프트 가정과 실측 차이)
- [x] `grimoire-server/HANDOVER.md` 갱신
- [x] `grimoire-server/TODO.md` P0 체크
- [x] `grimoire-server/research/HARNESS_ENGINEERING.md` Phase 1 완료 주석
- [x] `memory/project_session_20260425.md` + MEMORY.md 인덱스
- [x] PROGRESS_HARNESS_P0.md 전 Phase 체크 완료
