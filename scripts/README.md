# scripts/ — 시드 및 마이그레이션 스크립트

## 핵심 원칙

- **운영 DB의 원고 데이터는 스크립트로 건드리지 않는다**
- 모든 스크립트는 `DATABASE_URL` 환경변수 필수
- 하드코딩된 DB 비밀번호 절대 금지

---

## 로컬 공개 준비용 시드

`APP_ENV=localhost`와 쿼리 없는 루프백 DATABASE_URL을 명시해야 한다.
Prisma 시드 8종과 DeerDevil API 시드는 원격 대상을 거절한다. localhost 시드는 기존
DB에도 데이터를 쓸 수 있으므로 반드시 새 격리 DB를 준비한다.

새 격리 DB의 재현 검증에는 `seed:demo`를 사용한다. 외부 원고·파일을 읽지 않고 가상 계정
local-writer/local-reader와 예시 작품·회차·테마·포인트 원장을 한 트랜잭션으로 만든다.
비어 있지 않은 DB는 거절한다. 관리자는 `seed:admin`으로 별도 생성한다.
필수 관리자 설정은 SEED_ADMIN_SLUG, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD이다.

실행 명령과 설정 주입은 [환경 정본](../docs/environments.md#공개-준비용-로컬-실행-2026-11-13)을 따른다.

## 과거 스크립트 목록

### seed-all.ts — 과거 원본 콘텐츠 시드 (별도 로컬 DB 전용)

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

### 원고 권리 확인

2026-11-13 사용자 확인: DeerDevil 원고는 사용자 본인이 썼고, 고전문학 원문은 저작권이 없는 자료다. 이 확인은 실제 원문과 시드 코드를 구분해 기록한다. 원고 전량 확보·원본 대조는 별도 후속 TODO이며, 이 문구만으로 전량 확보를 완료했다고 표시하지 않는다.

## 과거 DB 동기화 도구의 로컬 대상

`db-sync-local.sh`와 `db-sync.ts ... local`은 대상 `LOCAL_DATABASE_URL`을 명시해야 한다.
로컬 대상은 인증 정보와 DB 이름이 있는 루프백 비5432 포트만 허용하며 URL 쿼리를 거절한다.
기존 기본 비밀번호와 localhost:5432 기본 대상은 제거했다. 원격에서 데이터를 복사하는 운영 도구이므로
공개 준비의 로컬 시작·가상 시드 절차에서는 실행하지 않는다.
