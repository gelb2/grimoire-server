# TESTING.md — grimoire-server

> 테스트 전략 + 현황.

---

## 1. 프레임워크

| 도구 | 용도 |
|------|------|
| Jest | 유닛 + 통합 테스트 |
| ts-jest | TypeScript 변환 |
| supertest | HTTP 통합 테스트 (Phase 2) |

---

## 2. 테스트 실행

```bash
npm test              # 전체 테스트
npm run test:watch    # 워치 모드
npm run test:cov      # 커버리지 리포트
```

---

## 3. 테스트 구조

```
src/
├── lib/
│   ├── json-parser.spec.ts      # JSON 에러 복구 (7개)
│   ├── md-parser.spec.ts        # MD 파서 (16개)
│   └── txt-parser.spec.ts       # TXT 파서 + 포맷 감지 (11개)
├── application/
│   ├── auth/
│   │   └── auth.usecase.spec.ts             # 인증 (등록/로그인) (6개)
│   ├── theme/
│   │   └── generate-theme.usecase.spec.ts  # 테마 생성 로직 (6개)
│   └── credit/
│       └── credit.usecase.spec.ts          # 크레딧 차감/적립 (14개)
```

---

## 4. 현황

| 구분 | 테스트 수 | 상태 |
|------|----------|------|
| json-parser | 7 | 통과 |
| md-parser | 16 | 통과 |
| txt-parser | 11 | 통과 |
| auth.usecase | 6 | 통과 |
| generate-theme.usecase | 6 | 통과 |
| credit.usecase | 14 | 통과 |
| **합계** | **60** | **전부 통과** |

---

## 5. 테스트 패턴

### Mock 전략

- UseCase 테스트: Repository 포트를 jest.fn()으로 모킹
- Claude API: ClaudeApiPort를 모킹 (실제 API 호출 방지)
- Prisma: 통합 테스트에서만 실제 DB 사용 (Phase 2)

### 네이밍

- 파일: `*.spec.ts` (Jest 기본 testRegex)
- describe: 클래스/함수명
- it: 한국어로 기대 동작 서술

---

## 6. 커밋 전 필수

1. `npm test` 전부 통과
2. `npm run build` 성공
3. 새 기능 추가 시 해당 테스트도 함께 작성

---

## 7. 참조 문서

- `CLAUDE.md` §3 — 테스트 필수 규칙
- 루트 `CLAUDE.md` §2 — 테스트 미통과 커밋 금지
