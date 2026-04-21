# Harness Engineering — 리서치 노트

> **작성일**: 2026-04-19
> **발단**: 2026-04-19 세션에서 사용자가 Martin Fowler 원문과 Reddit 커뮤니티 스레드를 공유하며 ProjectGrimoire의 harness 수준 점검을 지시.
> **상태**: 리서치 정리 + ProjectGrimoire 현황 대조 + TODO 연동 완료.

---

## 1. Harness Engineering 정의 (Martin Fowler)

Fowler의 2026년 정의: **"Everything in an AI agent except the model itself"**. 모델을 감싸 **가이드(feedforward)**와 **센서(feedback)**로 에이전트 행동을 **조종(steer)**하고 **규제(regulate)**하는 사용자 구축 시스템.

핵심 시각: 모델 품질만으로는 코딩 에이전트의 실수를 막을 수 없으므로 **주변을 조이는 엔지니어링**이 필요하다.

## 2. 핵심 구성요소 (4축)

| 축 | 설명 | ProjectGrimoire 예시 |
|---|---|---|
| **Guides (Feedforward)** | 에이전트가 행동하기 **전에** 방향을 제시 — 프롬프트, 스킬, 규칙 문서, 정본 문서, 템플릿 | CLAUDE.md §0 절대 규정, PLANNING_GRIMOIRE.md, docs/*.md 정본, .claude/prompts/*.txt |
| **Sensors (Feedback)** | 에이전트가 행동한 **후에** 이상 신호를 LLM이 소비할 수 있는 형태로 리턴 | .claude/scripts/sensor-*.sh (docs-sync, security-gate, server, web), pre-push 훅, 테스트 실행 |
| **Computational** | 결정적·빠름·저비용 CPU 도구 (린터, 타입체크, 테스트) | tsc, vitest, jest, eslint, docs 동기화 검증 스크립트 |
| **Inferential** | 의미 기반·느림·비용 GPU 도구 (LLM as judge, review agent) | 서브에이전트 7종 (planner/researcher/cost-accountant/visual-canon-keeper/qa/server/web) |

## 3. 핵심 원리

| 원리 | 요약 | 적용 시사점 |
|---|---|---|
| **Shift Left** | "Keep quality left" — 비용이 낮은 단계에서 최대한 막는다 | Edit 직후 tsc auto > pre-push > CI > 프로덕션 배포 전 preflight |
| **Steering Loop** | 반복 문제 발견 시 harness를 진화시킨다 (에이전트에게 직접 harness를 만들게 할 수도) | 2026-04-19 세션 실수 → TODO에 harness 보강 항목 박제한 것이 이 루프 예시 |
| **Requisite Variety (Ashby)** | 규제자는 규제 대상만큼의 variety를 가져야 한다 | 엔드포인트/파서/테마 조합의 복잡성만큼 sensor가 늘어나야 함 |
| **Harnessability** | 일부 코드베이스는 본질적으로 harness 친화적 (정적 타입, 명확한 경계) | TypeScript strict + Hexagonal + FSD 아키텍처는 ProjectGrimoire의 큰 자산 |
| **Ambient Affordances** | 구조적 환경이 에이전트에 "legible, navigable, tractable"하도록 | 정본 문서 피라미드, 문서 동기화 규칙, 명확한 라우트 구조 |

## 4. 경계해야 할 실패 모드 (Fowler 정리)

| 실패 모드 | 설명 | ProjectGrimoire에서 관찰된 사례 |
|---|---|---|
| **Feedback-only harness** | 규칙 없이 검증만 하면 같은 실수를 무한 반복 | 이번 세션의 "매번 허용 누르세요" TCC 헛소리 — Skill/Guide 부재 |
| **Feedforward-only harness** | 규칙만 많고 실행 결과 검증 없음 | CLAUDE.md §0 경고는 있으나 검증 sensor가 "메모리 freshness" 4개뿐 |
| **Over-reliance on AI-generated tests** | LLM이 만든 테스트는 아직 신뢰도 부족 | 서브에이전트 리포트(researcher/qa)를 그대로 정답으로 받지 말 것 |
| **Silent sensors** | 센서가 한 번도 울리지 않으면 품질이 좋은 건지 감지 안 되는 건지 모호 | sensor-*.sh가 실제로 실패 케이스를 잡아본 이력 추적 필요 |
| **Harness drift** | 가이드와 센서가 시스템 성장에 따라 서로 모순 | CLAUDE.md §14 "미도입" 표기 vs 실제 sensors/knowledge 도입된 상태 |

## 5. Guides vs Sensors — Fowler 도식

```
      ┌──────────────────┐
      │     사용자        │
      └────┬─────────┬───┘
           │         │
  ┌────────▼────┐ ┌──▼──────────┐
  │   Guides    │ │   Sensors   │
  │ (feedforward│ │ (feedback)  │
  └────────┬────┘ └──┬──────────┘
           │         │
      ┌────▼─────────▼────┐
      │   Coding Agent    │
      │    (LLM Model)    │
      └───────┬───────────┘
              ▼
         코드 산출물
```

- Guides는 **비용 낮고 선제적** (프롬프트 토큰, 정본 문서 참조)
- Sensors는 **비용 분산** — 빠른 것(tsc)은 Edit 직후, 비싼 것(E2E)은 pre-push 또는 배포 전

## 6. ProjectGrimoire 현황 대조 (2026-04-19 실측)

### ✅ 이미 도입된 Harness 축

| 도입 요소 | 위치 | 축 분류 |
|---|---|---|
| Sub-agents 7개 | `.claude/agents/*.md` | Inferential |
| Sensors 4개 (docs-sync, security-gate, server, web 빌드) | `.claude/scripts/sensor-*.sh` | Computational/Sensor |
| Memory hooks 4종 (SessionStart, Stop, UserPromptSubmit, PreCompact) | `.claude/settings.json` | Guide 재로딩 유도 |
| pre-push hook (server만) | `grimoire-server/.githooks/pre-push` | Sensor (tsc+test+build+docs) |
| 정본 문서 피라미드 | CLAUDE.md §5 | Guide |
| 문서 동기화 규칙 | CLAUDE.md §3 | Guide |
| 서브에이전트 독립 검증 | launchd 자율 실행 plist (현재 제거된 상태) | Inferential |

### ❌ 빠진 Harness 축 (이번 리서치로 확인된 약점)

| 빠진 요소 | 영향 | 해결 경로 |
|---|---|---|
| **PostToolUse hook** | Edit/Write 직후 컴파일/린트/테스트 자동 실행 없음 → Shift-Left 최대치 활용 불가 | `.claude/settings.json`에 hook 추가 |
| **PreToolUse hook** | 위험 명령 차단 없음 (main 직접 push, rm -rf, 평문 비밀번호 노출 등) | 동일 |
| **Skills** (`.claude/skills/`) | 재발 방지 프로토콜 문서화 경로 없음 → feedback_*.md 파일을 매 세션 Claude가 읽을지 불확실 | Skill로 승격 |
| **Slash commands** (`.claude/commands/`) | `/fullcheck`, `/deploy-precheck` 같은 반복 검증 자동화 없음 | 정의 + 등록 |
| **grimoire-web pre-push** | 서버는 있으나 웹 없음 | 같은 스크립트 이식 |
| **MCP servers** (`.mcp.json`) | 도메인 특화 도구(Polar 크레딧, Azure Container App 상태) 부재 | 별도 MCP 프로세스 정의 |

## 7. 2026-04-19 세션 실수 유형 × Fowler 프레임 매핑

이번 세션에서 실제로 발생한 제 실수를 Fowler의 프레임으로 분류:

| 실수 | Fowler 분류 | 부재했던 harness |
|---|---|---|
| TCC "매번 허용 누르세요" 헛소리 | Guide 부재 + Silent sensor | Skill `macos-tcc-handling` + credsStore 사전 검증 script |
| fetch aborted 원인을 추측으로 설명 | Guide 부재 (추정 금지 규칙이 CLAUDE.md §0에 있지만 센서화 안 됨) | Skill `production-bug-triage`로 "curl→코드 추적→금지어 체크" 절차화 |
| 환불 UI 문구 거짓말 | Feedforward-only 실패 (문구 추가 시 서버 근거 검증 없음) | PostToolUse hook: UI 파일에 "자동 환불" 문구 추가 시 서버 usecase 패턴 매칭 강제 |
| Chrome extension 조기 포기 | Silent sensor (재시도 규정 없음) | Skill `claude-in-chrome-recovery` + 3회 재시도 규정 |
| db-sync --mask-pii 회귀 미감지 | Sensor 부재 (dev 로그인 스모크 테스트 없음) | Slash command `/dev-login-smoke` |

## 8. Fowler의 열린 문제 (ProjectGrimoire 관점 재해석)

- **"How to keep coherent harnesses as they scale?"** → ProjectGrimoire는 TASK_QUEUE.json 같은 중앙 오케스트레이션 없음. 서브에이전트 7개가 독립 실행 중 — 상호 모순 감지 체계 필요
- **"What metrics evaluate harness coverage?"** → 현재 sensor가 실제로 실패를 잡은 **hit rate** 추적 없음. launchd 실행 로그만 있음
- **"Toolchain harness config across pipeline?"** → `.claude/` 단위로 관리 중이나 server/web 각 레포에도 `.claude/launch.json`만 있고 hooks/skills는 루트 집중 → 레포별 harness와 루트 harness의 경계/우선순위 정의 필요

## 9. 커뮤니티 리소스 (2026-04 기준, WebSearch 경유)

직접 fetch 실패한 Reddit 스레드(`/r/ClaudeAI/comments/1s9jm0d`) 대신 같은 주제의 주요 가이드/레포 식별:

| 리소스 | 용도 | 비고 |
|---|---|---|
| Claude Code docs — Skills | Skill 기본 문법, YAML frontmatter | 공식. `.claude/skills/<name>/SKILL.md` 규약 |
| GitHub `Chachamaru127/claude-code-harness` | Go 기반 guardrail + hook handler + 5 verb skills (plan/execute/review/release/setup) | v4에서 13 declarative rules (R01–R13), 서브 10ms 응답 |
| GitHub `affaan-m/everything-claude-code` ("ECC") | Skills/instincts/memory/security 번들 | 125 instruction sets + 28 agent definitions. 커뮤니티에서 논란(bundling 과잉) |
| GitHub `hesreallyhim/awesome-claude-code` | 큐레이트된 skills/hooks/slash-commands/agent orchestrators/plugins 목록 | 레퍼런스 진입점 |
| Paradime 가이드 "Claude Code Skills & Harness Engineering" | Rules + Plugins + MCP 통합 가이드 | 비교적 최근 문서 |
| Medium — David R Oliver "Skills and Hooks Starter Kit" (2026-02) | Skills + Hooks 최소 세팅 튜토리얼 | 작은 시작점 선호 시 유용 |

## 10. ProjectGrimoire 채택 권장 순위 (이 리서치 근거)

TODO 연동: `grimoire-server/TODO.md` "Claude Code harness 강화" 섹션 + `grimoire-web/TODO.md` 보조.

**즉시 (P0)**
1. `grimoire-web/.githooks/pre-push` 이식 — Shift-Left 기본
2. PostToolUse hook — Edit 후 tsc auto (Fowler "fast computational" 축의 최저 비용 sensor)

**단기 (P1)**
3. Skills 3종 (TCC, bug-triage, chrome-recovery) — 이번 세션 실수 유형을 가장 직접 차단
4. `hesreallyhim/awesome-claude-code`에서 검증된 패턴 스카우트

**중기 (P2)**
5. Slash commands 3종 (`/dev-login-smoke`, `/deploy-precheck`, `/refund-logic-audit`)
6. Harness hit-rate 메트릭 (sensor 로그 집계)

**장기 (P3)**
7. MCP 서버 정의 (Polar/Azure 도메인 특화)
8. PreToolUse hook으로 main 직접 push / 위험 명령 차단
9. CLAUDE.md §14 실측 반영 (문서 drift 해소)

## 11. 출처

- Martin Fowler — ["Harness Engineering for Coding Agents"](https://martinfowler.com/articles/harness-engineering.html)
- Reddit `/r/ClaudeAI` — "I had Claude read every harness engineering guide..." (원문 fetch 제한, 스레드 URL: https://www.reddit.com/r/ClaudeAI/comments/1s9jm0d/i_had_claude_read_every_harness_engineering_guide/)
- [Claude Code Skills 공식 문서](https://code.claude.com/docs/en/skills)
- [GitHub — Chachamaru127/claude-code-harness](https://github.com/Chachamaru127/claude-code-harness)
- [GitHub — affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)
- [GitHub — hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)
- [Paradime — Claude Code Skills & Harness Engineering](https://www.paradime.io/guides/claude-code-skills-plugins-rules-guide)
- [Medium — David R Oliver "Skills and Hooks Starter Kit" (2026-02)](https://medium.com/@davidroliver/skills-and-hooks-starter-kit-for-claude-code-c867af2ace32)
- [Medium — Jiten Oswal "Ultimate Claude Code CLI Deep Dive" (2026-04)](https://medium.com/@jiten.p.oswal/the-ultimate-claude-code-cli-deep-dive-guide-to-the-newest-commands-from-april-2026-release-1eeb25b03c52)
- [Medium — Ewan Mak "Everything Claude Code: 82K-Star Agent Harness" (2026-03)](https://medium.com/@tentenco/everything-claude-code-inside-the-82k-star-agent-harness-thats-dividing-the-developer-community-4fe54feccbc1)
