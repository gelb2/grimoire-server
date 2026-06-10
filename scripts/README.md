# scripts/ — 시드 및 마이그레이션 스크립트

## 핵심 원칙

- **운영 DB의 원고 데이터는 스크립트로 건드리지 않는다**
- 모든 스크립트는 `DATABASE_URL` 환경변수 필수
- 하드코딩된 DB 비밀번호 절대 금지

---

## 스크립트 목록

### seed-all.ts — 통합 시드 (추천)

빈 DB를 완전한 상태로 초기화한다. 최초 1회 또는 DB 재생성 시 사용.

```bash
DATABASE_URL="postgresql://..." npx tsx scripts/seed-all.ts
DATABASE_URL="postgresql://..." npx tsx scripts/seed-all.ts --skip-deerdevil
DATABASE_URL="postgresql://..." npx tsx scripts/seed-all.ts --skip-classics
```

실행 순서:
1. 작가 11명 + 테마 생성 (upsert)
2. DeerDevil 작품 + 15개 에피소드 생성
3. DeerDevil 에피소드 md-parser로 재파싱
4. DeerDevil 에피소드 slug/type/orderNum 수정
5. 고전문학 ~60개 작품 + 에피소드 생성
6. 작가별 tagline + dividerIcon 적용
7. DeerDevil 완전한 테마 업데이트

### 개별 스크립트

각 스크립트는 독립 실행도 가능하다. seed-all.ts 내부에서도 호출됨.

| 스크립트 | 용도 | 멱등성 |
|---------|------|--------|
| `seed-themes.ts` | 작가 11명 + 테마 생성 | O (upsert) |
| `seed-deerdevil.ts` | DeerDevil 에피소드 (API 경유) | 부분적 |
| `seed-more-classics.ts` | 고전문학 ~60개 작품 (Prisma 직접) | O (존재 확인) |
| `seed-theme-taglines.ts` | tagline + dividerIcon 추가 | O (병합) |
| `reparse-deerdevil.ts` | DeerDevil 블록 재파싱 | O (덮어쓰기) |
| `fix-deerdevil-episodes.ts` | DeerDevil slug/type 수정 | O (변경 없으면 스킵) |
| `update-deerdevil-theme.ts` | DeerDevil 테마 완전 교체 | O (upsert) |

---

## Prisma 마이그레이션

스키마 변경은 Prisma 마이그레이션으로 관리한다.

```bash
# 개발 중 스키마 변경 적용
npx prisma migrate dev --name {migration-name}

# 운영 DB에 마이그레이션 적용
npx prisma migrate deploy
```

---

## 주의사항

1. **운영 DB에서 seed-all.ts를 실행하지 마라** — 테스트 계정 비밀번호가 덮어씌워진다
2. seed-deerdevil.ts는 API 경유 방식이므로 서버가 실행 중이어야 한다
3. seed-more-classics.ts는 Prisma 직접 접근이므로 서버 실행 불필요
4. `--skip-deerdevil` 사용 시 DeerDevil MD 파일이 없어도 실행 가능
