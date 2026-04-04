# SECURITY_TODO.md — 보안 점검 결과 + 조치 목록

> 2026-04-05 보안 분석 결과. 긴급도 순으로 정렬.
> 완료 시 체크하고 날짜 기록.

---

## 🔴 CRITICAL — 즉시 수정 필요

### 1. IDOR: 테마 생성 엔드포인트에서 authorId를 body에서 받음
- **파일:** `src/adapter/inbound/http/controller/theme.controller.ts` (line 42)
- **문제:** `dto.authorId`를 사용 → 인증된 사용자가 다른 사용자의 authorId를 넣어서 피해자의 크레딧을 소모시킬 수 있음
- **수정:** `dto.authorId` → `req.user.sub`로 변경
- **상태:** [ ] 미수정

---

## 🟡 MEDIUM — 조기 수정 권장

### 2. 크레딧 차감 Race Condition
- **파일:** `src/application/theme/generate-theme.usecase.ts` (line 41-47)
- **문제:** 크레딧 체크와 차감이 별도 쿼리 → 동시 요청 시 잔액 이하로 차감 가능
- **수정:** `$transaction`으로 체크+차감을 원자적으로 묶기
- **영향도:** 낮음 (rate limiting 5회/분이 1차 방어)
- **상태:** [ ] 미수정

### 3. HWPX Zip Bomb
- **파일:** `src/lib/hwp-parser.ts` (line 53)
- **문제:** `JSZip.loadAsync(buffer)` 시 압축해제 크기 제한 없음 → DoS 가능
- **수정:** 압축해제 후 총 크기 50MB 제한 추가
- **상태:** [ ] 미수정

---

## ✅ 확인 완료 — 안전

| 항목 | 상태 | 근거 |
|------|------|------|
| SQL Injection | ✅ | Prisma ORM 전용, raw query도 파라미터화 |
| XSS | ✅ | `escapeHtml()` 적용, `dangerouslySetInnerHTML` 미사용 |
| JWT 처리 | ✅ | HttpOnly + Secure + SameSite=strict |
| 관리자 인증 | ✅ | JwtAuthGuard + AdminGuard (DB role 검증) |
| Rate Limiting | ✅ | 모든 mutation에 @Throttle 적용 |
| 공유 링크 보안 | ✅ | 48자 hex 토큰 (192bit), 서버사이드 만기 체크 |
| 파일 업로드 검증 | ✅ | 확장자 + 크기 제한 (원고 10MB, 커버 5MB) |
| 결제 원자성 | ✅ | $transaction으로 Payment+Credit+Log 원자 처리 |
| 댓글 이스케이프 | ✅ | escapeHtml()로 &, <, >, ", ' 이스케이프 |
| CORS | ✅ | 환경별 도메인 설정 (wildcard 아님) |
| Helmet | ✅ | HTTP 보안 헤더 적용 |
| 소유권 검증 | ✅ | 모든 mutation에서 authorId === req.user.sub 체크 |
| reCAPTCHA | ✅ | v3 토큰 검증 + 점수 0.5 이상 |
| 민감 데이터 노출 | ✅ | authorId, rawMd, passwordHash 응답에서 제외 |

---

## 📋 추가 권장사항 (비긴급)

- [ ] DOCX 파싱: mammoth 추출 콘텐츠 최대 크기 제한 (현재 파일 크기만 체크)
- [ ] 환경변수 CORS_ORIGIN 누락 시 기본값이 없음 → 명시적 에러 또는 localhost 폴백
- [ ] 크레딧 환불 로직: 현재 별도 쿼리지만 API 실패가 드물어 수용 가능
- [ ] 비로그인 댓글 비밀번호: bcryptjs 사용 확인 (감사 로그에 해시만 저장)
