/**
 * DB 동기화 스크립트 — source DB의 데이터를 target DB로 복사
 *
 * 사용법 (2026-04-19 inhouse 제거 / 2026-05-27 GCP 영역 정합):
 *   npx tsx scripts/db-sync.ts prod dev --mask-pii
 *   npx tsx scripts/db-sync.ts prod dev --mask-pii --preserve-accounts
 *   npx tsx scripts/db-sync.ts dev local
 *
 * 옵션:
 *   --mask-pii          PII(이메일, 비밀번호 해시, OAuth 이메일)를 마스킹
 *   --preserve-accounts DB_SYNC_PRESERVE_EMAILS 환경변수의 이메일 목록은 마스킹 스킵
 *                       (2026-04-19 회귀: --mask-pii로 dev 로그인 불가 → 테스트 계정 보존용)
 *
 * 환경변수 (2026-05-27 GCP 영역 신설 — Cloud SQL Auth Proxy 영역 정합):
 *   DB_PASSWORD_SOURCE         source DB 비밀번호 (필수, 신 영역 — Cloud SQL grimoireadmin)
 *   DB_PASSWORD_TARGET         target DB 비밀번호 (필수, 신 영역 — Cloud SQL grimoireadmin)
 *   DB_HOST_SOURCE             source DB host (선택, 기본 127.0.0.1) — Auth Proxy 영역 localhost
 *   DB_HOST_TARGET             target DB host (선택, 기본 127.0.0.1)
 *   DB_PORT_SOURCE             source DB port (선택, 기본 5432)
 *   DB_PORT_TARGET             target DB port (선택, 기본 5433)
 *   DB_SSL_MODE                sslmode (선택, 기본 disable) — Auth Proxy 영역 plaintext 영역 정합
 *
 *   DB_PASSWORD                (Legacy, deprecated) — DB_PASSWORD_SOURCE/TARGET 미설정 시 fallback
 *   DB_SYNC_PRESERVE_EMAILS    --preserve-accounts 사용 시 마스킹 제외할 이메일 (콤마 분리)
 *                              예: deerdevil@example.com,admin@example.com
 */

import { PrismaClient } from '@prisma/client'

// 2026-05-27 GCP 영역: DB_PASSWORD_SOURCE/TARGET 영역 신설 (Cloud SQL Auth Proxy 영역 정합).
// 환경별 비밀번호 영역 분리 강제 (dev/prod Cloud SQL 영역 분리 영역).
// Legacy DB_PASSWORD 영역 fallback 영역 — 기존 로컬 호출자 영역 보존.
const LEGACY_PW = process.env.DB_PASSWORD
const PW_SOURCE = process.env.DB_PASSWORD_SOURCE || LEGACY_PW
const PW_TARGET = process.env.DB_PASSWORD_TARGET || LEGACY_PW
if (!PW_SOURCE || !PW_TARGET) {
  console.error('❌ DB_PASSWORD_SOURCE + DB_PASSWORD_TARGET env 필수 (또는 legacy DB_PASSWORD).')
  console.error('   예: DB_PASSWORD_SOURCE=... DB_PASSWORD_TARGET=... npx tsx scripts/db-sync.ts prod dev --mask-pii')
  process.exit(1)
}
const ADMIN = 'grimoireadmin'

// GCP Cloud SQL Auth Proxy 영역 정합 — host/port 영역 환경변수 영역 주입 강제
const HOST_SOURCE = process.env.DB_HOST_SOURCE || '127.0.0.1'
const HOST_TARGET = process.env.DB_HOST_TARGET || '127.0.0.1'
const PORT_SOURCE = process.env.DB_PORT_SOURCE || '5432'
const PORT_TARGET = process.env.DB_PORT_TARGET || '5433'
const SSL_MODE = process.env.DB_SSL_MODE || 'disable'

// PII 마스킹용 고정 bcrypt 해시 (비밀번호: "masked2026")
const MASKED_PASSWORD_HASH = '$2b$10$KjXGfJxQJfzQ2q8lRj5zWOBYcZJg.Zq0Z9R8Q1RVG8J5r5t8N2H0O'

function getPreserveEmails(): Set<string> {
  const raw = process.env.DB_SYNC_PRESERVE_EMAILS || ''
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  )
}

// 2026-05-27 GCP 영역: role 영역 (source/target) 영역 별 host/port/password 영역 주입 강제.
// Auth Proxy 영역 정합 — env 영역 명칭 영역 (prod/dev/local) 영역 ≠ 직접 host 영역 박제.
function getDbUrl(env: string, role: 'source' | 'target'): string {
  if (env === 'local') {
    // 로컬 docker-compose 기본값 — 외부 노출 영향 없음
    const localPw = process.env.LOCAL_DB_PASSWORD || 'REMOVED_CREDENTIAL_011'
    return `postgresql://${ADMIN}:${localPw}@localhost:5432/grimoire`
  }
  // 원격 영역 (prod/dev) — Auth Proxy 영역 localhost:port 영역 정합 영역 강제
  const pw = role === 'source' ? PW_SOURCE : PW_TARGET
  const host = role === 'source' ? HOST_SOURCE : HOST_TARGET
  const port = role === 'source' ? PORT_SOURCE : PORT_TARGET
  return `postgresql://${ADMIN}:${pw}@${host}:${port}/grimoire?sslmode=${SSL_MODE}`
}

const VALID_ENVS = ['prod', 'dev', 'local']

// 동기화 방향 검증 (상위 → 하위만 허용)
const ENV_RANK: Record<string, number> = { prod: 3, dev: 1, local: 0 }

function maskAuthors(
  authors: any[],
  maskPii: boolean,
  preserveEmails: Set<string>,
): any[] {
  if (!maskPii) return authors
  return authors.map((a, i) => {
    const email = (a.email || '').toLowerCase()
    if (preserveEmails.has(email)) {
      // 보존 대상 — email/passwordHash 그대로 유지
      return a
    }
    return {
      ...a,
      email: `author-${i + 1}@masked.local`,
      passwordHash: MASKED_PASSWORD_HASH,
    }
  })
}

function maskSocialAccounts(
  accounts: any[],
  authors: any[],
  maskPii: boolean,
  preserveEmails: Set<string>,
): any[] {
  if (!maskPii) return accounts
  // 보존 작가의 authorId 추출 (해당 작가의 SocialAccount는 providerEmail도 보존)
  const preserveAuthorIds = new Set(
    authors
      .filter((a) => preserveEmails.has((a.email || '').toLowerCase()))
      .map((a) => a.id),
  )
  return accounts.map((sa, i) => {
    if (preserveAuthorIds.has(sa.authorId)) {
      return sa
    }
    return {
      ...sa,
      providerEmail: `social-${i + 1}@masked.local`,
    }
  })
}

async function main() {
  const args = process.argv.slice(2)
  const maskPii = args.includes('--mask-pii')
  const preserveAccounts = args.includes('--preserve-accounts')
  const positionalArgs = args.filter((a) => !a.startsWith('--'))
  const [source, target] = positionalArgs

  const preserveEmails = preserveAccounts ? getPreserveEmails() : new Set<string>()
  if (preserveAccounts && preserveEmails.size === 0) {
    console.error('❌ --preserve-accounts 사용 시 DB_SYNC_PRESERVE_EMAILS 환경변수에 콤마 분리 이메일 목록이 필요합니다')
    console.error('   예: DB_SYNC_PRESERVE_EMAILS=deerdevil@example.com,admin@example.com')
    process.exit(1)
  }

  if (!source || !target) {
    console.error('사용법: npx tsx scripts/db-sync.ts [source] [target] [--mask-pii]')
    console.error('예: npx tsx scripts/db-sync.ts prod dev --mask-pii')
    console.error('환경: prod, dev, local')
    process.exit(1)
  }

  if (!VALID_ENVS.includes(source) || !VALID_ENVS.includes(target)) {
    console.error(`❌ 올바르지 않은 환경: ${source}, ${target}`)
    console.error(`   허용 환경: ${VALID_ENVS.join(', ')}`)
    process.exit(1)
  }

  if (source === target) {
    console.error('❌ source와 target이 같습니다')
    process.exit(1)
  }

  if (ENV_RANK[source] <= ENV_RANK[target]) {
    console.error(`❌ 하위 → 상위 동기화 금지: ${source} → ${target}`)
    console.error('   허용 방향: prod → dev → local')
    process.exit(1)
  }

  console.log(`╔══════════════════════════════════════════╗`)
  console.log(`║   DB 동기화: ${source} → ${target}${maskPii ? ' (PII 마스킹)' : ''}${preserveAccounts ? ' [보존 ' + preserveEmails.size + '개]' : ''}`)
  console.log(`╚══════════════════════════════════════════╝`)
  if (preserveAccounts) {
    console.log(`  보존 이메일: ${[...preserveEmails].join(', ')}`)
  }

  const sourceDb = new PrismaClient({ datasources: { db: { url: getDbUrl(source, 'source') } } })
  const targetDb = new PrismaClient({ datasources: { db: { url: getDbUrl(target, 'target') } } })

  try {
    // 1. Source에서 데이터 읽기
    console.log(`\n[1/3] ${source} DB에서 데이터 읽기...`)
    const authors = await sourceDb.author.findMany()
    const themes = await sourceDb.theme.findMany()
    const works = await sourceDb.work.findMany()
    const episodes = await sourceDb.episode.findMany()
    const socialAccounts = await sourceDb.socialAccount.findMany()
    const signupHistories = await sourceDb.signupHistory.findMany()
    // CC-4 Phase 3 (2026-05-21) — `creditLog` 모델 폐기. `CreditLedger` 단일 정본.
    const bookmarks = await sourceDb.bookmark.findMany()
    const readingProgress = await sourceDb.readingProgress.findMany()
    const likes = await sourceDb.like.findMany()
    const subscriptions = await sourceDb.subscription.findMany()
    const comments = await sourceDb.comment.findMany()
    const payments = await sourceDb.payment.findMany()
    const dailyViews = await sourceDb.dailyView.findMany()
    // 3환경 간 정합성에 영향을 주는 관리자/플랫폼 데이터 — 반드시 동기화 대상
    const announcements = await sourceDb.announcement.findMany()
    const featuredWorks = await sourceDb.featuredWork.findMany()
    const systemSettings = await sourceDb.systemSetting.findMany()

    console.log(`  authors: ${authors.length}, themes: ${themes.length}, works: ${works.length}, episodes: ${episodes.length}`)
    console.log(`  socialAccounts: ${socialAccounts.length}, payments: ${payments.length}`)
    console.log(`  bookmarks: ${bookmarks.length}, likes: ${likes.length}, comments: ${comments.length}, dailyViews: ${dailyViews.length}`)
    console.log(`  announcements: ${announcements.length}, featuredWorks: ${featuredWorks.length}, systemSettings: ${systemSettings.length}`)

    // PII 마스킹 적용
    const maskedAuthors = maskAuthors(authors, maskPii, preserveEmails)
    const maskedSocialAccounts = maskSocialAccounts(socialAccounts, authors, maskPii, preserveEmails)
    if (maskPii) {
      console.log(`  ⚠ PII 마스킹 적용됨: email, passwordHash, providerEmail`)
      if (preserveAccounts) {
        const preservedCount = maskedAuthors.filter((a) =>
          preserveEmails.has((a.email || '').toLowerCase()),
        ).length
        console.log(`  ✓ 마스킹 제외 작가 ${preservedCount}명 (DB_SYNC_PRESERVE_EMAILS)`)
      }
    }

    // 2. Target 데이터 삭제 (FK 역순)
    console.log(`\n[2/3] ${target} DB 데이터 초기화...`)
    await targetDb.dailyView.deleteMany()
    await targetDb.comment.deleteMany()
    await targetDb.like.deleteMany()
    await targetDb.subscription.deleteMany()
    await targetDb.readingProgress.deleteMany()
    await targetDb.bookmark.deleteMany()
    // GCP 마이그레이션 잔여 (2026-05-27) — CC-1~5 + Payment 신 모델 FK 의존 14건 추가 박제.
    // payment FK 의존 자식 (payment 전):
    await targetDb.refundLog.deleteMany()
    await targetDb.webhookEvent.deleteMany()
    await targetDb.webhookRetryQueue.deleteMany()
    await targetDb.reconciliationCheckpoint.deleteMany()
    await targetDb.payment.deleteMany()
    // CC-4 Phase 3 (2026-05-21) — `creditLog.deleteMany` 제거. `CreditLog` 모델 폐기.
    // 플랫폼 관리자 데이터 — Author/Work에 느슨 참조(FK 없음)
    await targetDb.systemSetting.deleteMany()
    await targetDb.featuredWork.deleteMany()
    await targetDb.announcement.deleteMany()
    await targetDb.episode.deleteMany()
    await targetDb.work.deleteMany()
    await targetDb.theme.deleteMany()
    await targetDb.socialAccount.deleteMany()
    await targetDb.signupHistory.deleteMany()
    // author FK 의존 자식 (author 전, 2026-05-27 신설):
    await targetDb.chatMessage.deleteMany()   // FK chatSession (cascade)
    await targetDb.chatSession.deleteMany()   // FK author
    await targetDb.creditLedger.deleteMany()  // FK author (CC-1, INVOKE 원인)
    await targetDb.membershipPlan.deleteMany()// FK author (CC-5)
    await targetDb.analysisReport.deleteMany()// FK author/work/episode
    await targetDb.adminAuditLog.deleteMany() // FK admin author
    await targetDb.report.deleteMany()        // FK author
    await targetDb.userSanction.deleteMany()  // FK author
    await targetDb.accessLog.deleteMany()     // FK author
    await targetDb.refreshToken.deleteMany()  // FK author
    await targetDb.author.deleteMany()
    console.log('  초기화 완료')

    // 3. Target에 데이터 삽입 (FK 순서)
    console.log(`\n[3/3] ${target} DB에 데이터 삽입...`)

    for (const a of maskedAuthors) {
      await targetDb.author.create({ data: a })
    }
    console.log(`  ✓ authors: ${maskedAuthors.length}`)

    for (const t of themes) {
      await targetDb.theme.create({ data: t as any })
    }
    console.log(`  ✓ themes: ${themes.length}`)

    for (const w of works) {
      await targetDb.work.create({ data: w as any })
    }
    console.log(`  ✓ works: ${works.length}`)

    for (const ep of episodes) {
      await targetDb.episode.create({ data: ep as any })
    }
    console.log(`  ✓ episodes: ${episodes.length}`)

    for (const sa of maskedSocialAccounts) {
      await targetDb.socialAccount.create({ data: sa as any })
    }
    console.log(`  ✓ socialAccounts: ${maskedSocialAccounts.length}`)

    for (const sh of signupHistories) {
      await targetDb.signupHistory.create({ data: sh as any })
    }
    console.log(`  ✓ signupHistories: ${signupHistories.length}`)

    // CC-4 Phase 3 (2026-05-21) — `creditLog.create` 루프 제거. `CreditLog` 모델 폐기.

    for (const bm of bookmarks) {
      await targetDb.bookmark.create({ data: bm as any })
    }
    console.log(`  ✓ bookmarks: ${bookmarks.length}`)

    for (const rp of readingProgress) {
      await targetDb.readingProgress.create({ data: rp as any })
    }
    console.log(`  ✓ readingProgress: ${readingProgress.length}`)

    for (const l of likes) {
      await targetDb.like.create({ data: l as any })
    }
    console.log(`  ✓ likes: ${likes.length}`)

    for (const s of subscriptions) {
      await targetDb.subscription.create({ data: s as any })
    }
    console.log(`  ✓ subscriptions: ${subscriptions.length}`)

    for (const c of comments) {
      await targetDb.comment.create({ data: c as any })
    }
    console.log(`  ✓ comments: ${comments.length}`)

    for (const p of payments) {
      await targetDb.payment.create({ data: p as any })
    }
    console.log(`  ✓ payments: ${payments.length}`)

    for (const dv of dailyViews) {
      await targetDb.dailyView.create({ data: dv })
    }
    console.log(`  ✓ dailyViews: ${dailyViews.length}`)

    // 플랫폼 관리자 데이터 (FK 없음 — Author/Work 이후 순서 자유)
    for (const a of announcements) {
      await targetDb.announcement.create({ data: a as any })
    }
    console.log(`  ✓ announcements: ${announcements.length}`)

    for (const fw of featuredWorks) {
      await targetDb.featuredWork.create({ data: fw as any })
    }
    console.log(`  ✓ featuredWorks: ${featuredWorks.length}`)

    for (const ss of systemSettings) {
      await targetDb.systemSetting.create({ data: ss as any })
    }
    console.log(`  ✓ systemSettings: ${systemSettings.length}`)

    // 검증
    const authorCount = await targetDb.author.count()
    const episodeCount = await targetDb.episode.count()
    console.log(`\n╔══════════════════════════════════════════╗`)
    console.log(`║   완료: ${target} DB — 작가 ${authorCount}명, 에피소드 ${episodeCount}편`)
    console.log(`╚══════════════════════════════════════════╝`)

  } finally {
    await sourceDb.$disconnect()
    await targetDb.$disconnect()
  }
}

main().catch((err) => { console.error('❌ 에러:', err.message); process.exit(1) })
