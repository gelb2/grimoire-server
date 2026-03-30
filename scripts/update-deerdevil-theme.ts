/**
 * DeerDevil 테마 업데이트 스크립트
 *
 * DeerDevil 원본에서 추출한 완전한 테마 JSON으로 DB를 업데이트한다.
 * layout, decorations, typingSpeed 등 새 필드 포함.
 *
 * 실행: DATABASE_URL="postgresql://..." npx tsx scripts/update-deerdevil-theme.ts
 */

import { PrismaClient } from '@prisma/client'

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL 환경변수가 필요합니다.')
  console.error('실행 예시: DATABASE_URL="postgresql://..." npx tsx scripts/update-deerdevil-theme.ts')
  process.exit(1)
}

const prisma = new PrismaClient()

// DeerDevil 원본에서 추출한 완전한 테마 — layout + decorations 포함
const DEERDEVIL_COMPLETE_THEME = {
  // 색상 (DeerDevil layout.tsx CSS variables 원본)
  bgPrimary: '#07070a',
  bgSecondary: '#0d0d12',
  textPrimary: '#cdc8bc',
  textMuted: '#7a7570',
  textDim: '#4a4740',
  textBright: '#e8e3d8',
  accent: '#9a8060',
  accent2: '#c4a46a',
  border: '#1e1e26',

  // 타이포그래피
  fontBody: 'serif',
  fontHeading: 'serif',

  // 분위기
  animation: 'typing',
  tone: 'dark',

  // 레이아웃 — series = 시리즈 소설 (탭 네비게이션)
  layout: 'series',

  // 장식 요소 — DeerDevil 원본 UI에서 추출
  decorations: {
    dividerIcon: 'antler',       // AntlerDivider / AntlerSVG 사용
    dividerColor: '#9a8060',     // --u-accent 색상
    headerIcon: 'antler',        // 랜딩 페이지 헤더 AntlerSVG
    headerSubtitle: 'Short Fiction Anthology',  // UniverseLanding 헤더
    cardAccentPosition: 'left',  // EpisodeCard 좌측 accent 라인
    footerText: 'Inspired by the sensibility of A24',  // 랜딩 페이지 하단
  },

  // Phase 1 타이포그래피/레이아웃
  titleSize: 'lg',
  titleWeight: 'bold',
  letterSpacing: 'normal',
  bodyLineHeight: 'relaxed',
  contentWidth: 'normal',

  // Phase 2 히어로/네비게이션
  heroStyle: 'minimal',
  navStyle: 'top',

  // 추가 시각 요소
  typingSpeed: 15,     // EpisodeViewer TypeWriter speed
  cardRadius: '8px',   // --radius-u-card
  navOpacity: 0.95,    // bg-u-bg/95

  // 태그라인
  tagline: 'Inspired by the sensibility of A24',
}

async function main() {
  console.log('=== DeerDevil 테마 업데이트 시작 ===')

  // 1. DeerDevil 작가 찾기
  const author = await prisma.author.findUnique({
    where: { slug: 'deerdevil' },
    include: { themes: true },
  })

  if (!author) {
    console.error('ERROR: deerdevil 작가를 찾을 수 없습니다.')
    console.error('먼저 seed-themes.ts를 실행해 주세요.')
    process.exit(1)
  }

  const existingTheme = author.themes[0]
  console.log(`  작가: ${author.name} (${author.slug})`)
  console.log(`  기존 테마: ${existingTheme ? '있음' : '없음'}`)

  // 2. 테마 update/create (1:N이므로 upsert({ where: { authorId } }) 불가)
  const themeData = {
    preset: 'midnight',
    overrides: DEERDEVIL_COMPLETE_THEME as object,
    rawDescription: 'A24 감성 K-다크 판타지. 어둡고 묵직한 밤의 분위기. 사슴뿔 아이콘과 타이핑 애니메이션.',
  }

  const result = existingTheme
    ? await prisma.theme.update({
        where: { id: existingTheme.id },
        data: themeData,
      })
    : await prisma.theme.create({
        data: { authorId: author.id, ...themeData },
      })

  console.log(`\n  [OK] 테마 업데이트 완료 (id: ${result.id})`)
  console.log(`  preset: ${result.preset}`)
  console.log(`  layout: ${DEERDEVIL_COMPLETE_THEME.layout}`)
  console.log(`  decorations.dividerIcon: ${DEERDEVIL_COMPLETE_THEME.decorations.dividerIcon}`)
  console.log(`  decorations.headerIcon: ${DEERDEVIL_COMPLETE_THEME.decorations.headerIcon}`)
  console.log(`  animation: ${DEERDEVIL_COMPLETE_THEME.animation}`)
  console.log(`  typingSpeed: ${DEERDEVIL_COMPLETE_THEME.typingSpeed}ms`)

  console.log('\n=== 업데이트 완료 ===')
}

main()
  .catch((err) => {
    console.error('치명적 오류:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
