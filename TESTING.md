# TESTING.md — grimoire-server

> 테스트 전략과 패턴.
> 현재 테스트 수: `npm test` 실행으로 확인.

---

## 1. 프레임워크

| 도구 | 용도 |
|------|------|
| Jest | 유닛 + 통합 테스트 |
| ts-jest | TypeScript 변환 |
| supertest | HTTP 통합 테스트 |

---

## 2. 테스트 실행

```bash
npm test              # 전체 테스트
npm run test:watch    # 워치 모드
npm run test:cov      # 커버리지 리포트
```

---

## 3. 테스트 구조

- 유닛 테스트: `src/lib/*.spec.ts`, `src/lib/rag/*.spec.ts` (파서, 유틸리티)
- UseCase 테스트: `src/application/*/*.spec.ts` (비즈니스 로직)
- 전체 테스트 파일 목록: `find src -name "*.spec.ts"` 실행으로 확인
- 현재 테스트 수: `npm test` 실행으로 확인

---

## 4. 테스트 패턴

### Mock 전략

- UseCase 테스트: Repository 포트를 jest.fn()으로 모킹
- Claude API: ClaudeApiPort를 모킹 (실제 API 호출 방지)
- Payment Gateway: PaymentGatewayPort를 모킹

### 네이밍

- 파일: `*.spec.ts` (Jest 기본 testRegex)
- describe: 클래스/함수명
- it: 한국어로 기대 동작 서술

---

## 5. 커밋 전 필수

1. `npm test` 전부 통과
2. `npm run build` 성공
3. 새 기능 추가 시 해당 테스트도 함께 작성

---

## 6. 참조 문서

- `CLAUDE.md` §3 — 테스트 필수 규칙
- 루트 `CLAUDE.md` §2 — 테스트 미통과 커밋 금지
