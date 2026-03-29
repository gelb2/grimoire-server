/**
 * 사슴악마 계정에 모든 테마 프리셋 시드
 *
 * - 기존 midnight 테마를 Phase 1/2 파라미터 포함으로 업데이트
 * - 7개 추가 프리셋 (parchment, morning, neon, cream, magazine, gallery, minimal) 생성
 * - 사슴악마가 테마 에디터에서 모든 프리셋을 선택/수정 가능
 *
 * 실행: npx tsx scripts/seed-theme-presets.ts
 */

import { PrismaClient } from '@prisma/client'

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL 환경변수가 필요합니다.')
  process.exit(1)
}

const prisma = new PrismaClient()

// 프리셋 테마 데이터 (web/src/features/theme/presets.ts 와 동기화)
const PRESETS: Record<string, object> = {
  midnight: {
    bgPrimary: '#07070a', bgSecondary: '#0d0d12',
    textPrimary: '#cdc8bc', textMuted: '#7a7570', textDim: '#4a4740', textBright: '#e8e3d8',
    accent: '#9a8060', accent2: '#c4a46a', border: '#1e1e26',
    fontBody: 'serif', fontHeading: 'serif',
    animation: 'typing', tone: 'dark', layout: 'series',
    decorations: {
      dividerIcon: 'antler', dividerColor: '#9a8060',
      headerIcon: 'antler', headerSubtitle: 'Short Fiction Anthology',
      cardAccentPosition: 'left', footerText: 'Inspired by the sensibility of A24',
    },
    titleSize: 'lg', titleWeight: 'bold', letterSpacing: 'normal',
    bodyLineHeight: 'relaxed', contentWidth: 'normal',
    heroStyle: 'minimal', navStyle: 'top',
    typingSpeed: 15, cardRadius: '8px', navOpacity: 0.95,
  },

  parchment: {
    bgPrimary: '#f5f0e8', bgSecondary: '#ebe5d8',
    textPrimary: '#3d3529', textMuted: '#8a7e6b', textDim: '#b5a992', textBright: '#1a1510',
    accent: '#8b6914', accent2: '#a67c1a', border: '#d5cbb8',
    fontBody: 'serif', fontHeading: 'serif',
    animation: 'fade', tone: 'sepia', layout: 'grid',
    decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' },
    titleSize: 'lg', titleWeight: 'bold', letterSpacing: 'normal',
    bodyLineHeight: 'relaxed', contentWidth: 'normal',
    heroStyle: 'minimal', navStyle: 'top',
  },

  morning: {
    bgPrimary: '#ffffff', bgSecondary: '#f8f8fa',
    textPrimary: '#1a1a1a', textMuted: '#6b7280', textDim: '#9ca3af', textBright: '#000000',
    accent: '#2563eb', accent2: '#3b82f6', border: '#e5e7eb',
    fontBody: 'sans-serif', fontHeading: 'sans-serif',
    animation: 'slide', tone: 'light', layout: 'grid',
    decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' },
    titleSize: 'lg', titleWeight: 'bold', letterSpacing: 'normal',
    bodyLineHeight: 'relaxed', contentWidth: 'normal',
    heroStyle: 'minimal', navStyle: 'top',
  },

  neon: {
    bgPrimary: '#0d0d0d', bgSecondary: '#1a1a2e',
    textPrimary: '#e0e0e0', textMuted: '#888899', textDim: '#555566', textBright: '#ffffff',
    accent: '#00ff88', accent2: '#00cc6a', border: '#2a2a3e',
    fontBody: 'monospace', fontHeading: 'monospace',
    animation: 'none', tone: 'dark', layout: 'grid',
    decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' },
    titleSize: 'lg', titleWeight: 'light', letterSpacing: 'wide',
    bodyLineHeight: 'relaxed', contentWidth: 'normal',
    heroStyle: 'minimal', navStyle: 'top',
  },

  cream: {
    bgPrimary: '#faf8f5', bgSecondary: '#f0ede8',
    textPrimary: '#4a4035', textMuted: '#8a7e70', textDim: '#b5aa9a', textBright: '#2a2018',
    accent: '#c4956a', accent2: '#d4a57a', border: '#e0d8cc',
    fontBody: 'serif', fontHeading: 'sans-serif',
    animation: 'none', tone: 'light', layout: 'grid',
    decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' },
    titleSize: 'lg', titleWeight: 'bold', letterSpacing: 'normal',
    bodyLineHeight: 'relaxed', contentWidth: 'narrow',
    heroStyle: 'minimal', navStyle: 'top',
  },

  magazine: {
    bgPrimary: '#ffffff', bgSecondary: '#f5f5f0',
    textPrimary: '#1a1a1a', textMuted: '#666666', textDim: '#999999', textBright: '#000000',
    accent: '#ff3333', accent2: '#cc0000', border: '#e0e0e0',
    fontBody: 'serif', fontHeading: 'sans-serif',
    animation: 'fade', tone: 'light', layout: 'magazine',
    decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'none', footerText: '' },
    titleSize: 'xl', titleWeight: 'black', letterSpacing: 'tight',
    bodyLineHeight: 'relaxed', contentWidth: 'wide',
    heroStyle: 'fullname', navStyle: 'sidebar',
  },

  gallery: {
    bgPrimary: '#0a0a0a', bgSecondary: '#141414',
    textPrimary: '#e0e0e0', textMuted: '#808080', textDim: '#4a4a4a', textBright: '#ffffff',
    accent: '#ff4444', accent2: '#ff6666', border: '#2a2a2a',
    fontBody: 'sans-serif', fontHeading: 'sans-serif',
    animation: 'fade', tone: 'dark', layout: 'gallery',
    decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'none', footerText: '' },
    titleSize: 'xl', titleWeight: 'black', letterSpacing: 'wide',
    bodyLineHeight: 'normal', contentWidth: 'wide',
    heroStyle: 'fullname', navStyle: 'hidden',
  },

  minimal: {
    bgPrimary: '#111111', bgSecondary: '#1a1a1a',
    textPrimary: '#d4d0c8', textMuted: '#8a8680', textDim: '#5a5650', textBright: '#f0ece4',
    accent: '#d4a46a', accent2: '#e4b47a', border: '#2a2a2a',
    fontBody: 'serif', fontHeading: 'serif',
    animation: 'none', tone: 'dark', layout: 'minimal',
    decorations: { dividerIcon: 'none', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'none', footerText: '' },
    titleSize: 'lg', titleWeight: 'light', letterSpacing: 'wide',
    bodyLineHeight: 'relaxed', contentWidth: 'narrow',
    heroStyle: 'cover', navStyle: 'hidden',
  },
}

async function main() {
  console.log('=== 사슴악마 테마 프리셋 시드 시작 ===')

  // 사슴악마 작가 찾기
  const deerdevil = await prisma.author.findUnique({ where: { slug: 'deerdevil' } })
  if (!deerdevil) {
    console.error('사슴악마 계정이 없습니다. seed-themes.ts를 먼저 실행하세요.')
    process.exit(1)
  }

  console.log(`작가: ${deerdevil.name} (${deerdevil.id})`)

  // 기존 테마 조회
  const existingThemes = await prisma.theme.findMany({
    where: { authorId: deerdevil.id },
  })
  console.log(`기존 테마: ${existingThemes.length}개`)

  // 기존 midnight 테마 업데이트 (Phase 1/2 파라미터 추가)
  const midnightTheme = existingThemes.find(t => t.preset === 'midnight')
  if (midnightTheme) {
    await prisma.theme.update({
      where: { id: midnightTheme.id },
      data: {
        overrides: PRESETS.midnight,
        rawDescription: 'A24 감성 K-다크 판타지 + Phase 1/2 타이포/레이아웃',
      },
    })
    console.log('  [UPDATE] midnight — Phase 1/2 파라미터 추가')
  }

  // 나머지 프리셋 생성 (이미 있으면 업데이트)
  const presetNames = Object.keys(PRESETS).filter(name => name !== 'midnight')
  for (const presetName of presetNames) {
    const existing = existingThemes.find(t => t.preset === presetName)
    if (existing) {
      await prisma.theme.update({
        where: { id: existing.id },
        data: { overrides: PRESETS[presetName], rawDescription: `프리셋: ${presetName}` },
      })
      console.log(`  [UPDATE] ${presetName}`)
    } else {
      await prisma.theme.create({
        data: {
          authorId: deerdevil.id,
          name: `프리셋: ${presetName}`,
          preset: presetName,
          overrides: PRESETS[presetName],
          rawDescription: `프리셋: ${presetName}`,
        },
      })
      console.log(`  [CREATE] ${presetName}`)
    }
  }

  // 슬롯 제한 확인 (free plan = 1개 제한이므로, 시드 데이터는 직접 DB에 넣어서 제한 우회)
  const finalCount = await prisma.theme.count({ where: { authorId: deerdevil.id } })
  console.log(`\n=== 완료: 사슴악마 테마 ${finalCount}개 ===`)
  console.log('프리셋:', Object.keys(PRESETS).join(', '))
}

main()
  .catch((err) => {
    console.error('치명적 오류:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
