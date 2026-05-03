-- 마이그레이션: baked_css_url의 상대 경로 박제 정리 (P1-#7, 2026-05-03)
--
-- 정책 (sprint-baked-css-url-absolute-progress.md §9 박제):
--   themes.baked_css_url은 항상 절대 URL(Blob CDN) 또는 NULL만 박제한다.
--   상대 경로(`/api/themes/css/...`) 박제는 환경 전환 시 stale → 폐지.
--   응답 시점에 server가 PUBLIC_API_BASE_URL로 동적 절대화하여 web에 반환한다.
--
-- 변경:
--   - schema.prisma: 변경 없음 (`bakedCssUrl: String?` 이미 NULL 허용)
--   - DDL: 없음 (DML 단발 — 무중단 OK)
--
-- WHERE 절 정책:
--   - LIKE '/api/themes/css/%' 정확 매칭 (절대 URL이 우연히 매칭되지 않게)
--   - 빈 문자열도 정리 (방어적)
--
-- 롤백 정책 (down 미작성):
--   본 마이그레이션은 일방향 — stale 상대 경로를 NULL로 정리하는 일회성 작업이다.
--   롤백은 publishTheme 재호출로 자동 재박제됨.
--   Prisma migrate resolve --rolled-back으로 메타만 정리 가능.

UPDATE themes
SET baked_css_url = NULL
WHERE baked_css_url LIKE '/api/themes/css/%'
   OR baked_css_url = '';
