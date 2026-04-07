/**
 * 작가 테마 + 테스트 계정 시드 스크립트
 *
 * - DeerDevil: deerDevil 프리셋 (사슴악마 전용, midnight과 독립)
 * - 고전문학 작가: 문학 스타일에 맞는 고유 테마 생성
 * - 모든 작가에게 test1234 비밀번호 + 10 크레딧 부여
 * - 멱등성 보장: 여러 번 실행해도 안전 (upsert 사용)
 *
 * 실행: DATABASE_URL="postgresql://..." npx tsx scripts/seed-themes.ts
 * 또는 .env 파일에 DATABASE_URL이 설정되어 있으면 자동으로 읽음
 */

import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

// DATABASE_URL 환경변수 확인
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL 환경변수가 필요합니다.')
  console.error('실행 예시: DATABASE_URL="postgresql://..." npx tsx scripts/seed-themes.ts')
  process.exit(1)
}

const prisma = new PrismaClient()

// ── 테마 타입 (web/src/features/theme/presets.ts 와 동일) ──

interface ThemeDecorations {
  dividerIcon: 'antler' | 'star' | 'dot' | 'line' | 'none'
  dividerColor: string
  headerIcon: 'antler' | 'quill' | 'book' | 'none'
  headerSubtitle: string
  cardAccentPosition: 'left' | 'top' | 'none'
  footerText: string
}

interface AuthorTheme {
  bgPrimary: string
  bgSecondary: string
  textPrimary: string
  textMuted: string
  textDim: string
  textBright: string
  accent: string
  accent2: string
  border: string
  fontBody: 'serif' | 'sans-serif' | 'monospace'
  fontHeading: 'serif' | 'sans-serif' | 'monospace'
  animation: 'typing' | 'fade' | 'slide' | 'none'
  tone: 'dark' | 'light' | 'sepia'
  layout: 'series' | 'grid' | 'classic'
  decorations: ThemeDecorations
  // 추가 시각 요소 (optional)
  typingSpeed?: number
  cardRadius?: string
  navOpacity?: number
}

// ── 작가별 테마 데이터 ──────────────────────────────────

interface AuthorSeed {
  name: string
  slug: string
  email: string
  theme: AuthorTheme
  preset: string
  description: string
}

const AUTHORS: AuthorSeed[] = [
  // DeerDevil — 사슴악마 작가 AI 생성 전용 테마 (antler 아이콘, midnight과 독립)
  {
    name: '사슴악마',
    slug: 'deerdevil',
    email: 'deerdevil@grimoire.app',
    preset: 'deerDevil',
    description: 'A24 감성 K-다크 판타지. 어둡고 묵직한 밤의 분위기. 사슴뿔 아이콘과 타이핑 애니메이션.',
    theme: {
      bgPrimary: '#07070a',
      bgSecondary: '#0d0d12',
      textPrimary: '#cdc8bc',
      textMuted: '#7a7570',
      textDim: '#4a4740',
      textBright: '#e8e3d8',
      accent: '#9a8060',
      accent2: '#c4a46a',
      border: '#1e1e26',
      fontBody: 'serif',
      fontHeading: 'serif',
      animation: 'typing',
      tone: 'dark',
      layout: 'series',
      decorations: {
        dividerIcon: 'antler',
        dividerColor: '#9a8060',
        headerIcon: 'antler',
        headerSubtitle: 'Short Fiction Anthology',
        cardAccentPosition: 'left',
        footerText: 'Inspired by the sensibility of A24',
      },
      typingSpeed: 15,
      cardRadius: '8px',
      navOpacity: 0.95,
    },
  },

  // 이광수 — 근대 계몽기, 진한 갈색/세피아 톤
  {
    name: '이광수',
    slug: 'lee-gwangsu',
    email: 'lee-gwangsu@grimoire.app',
    preset: 'custom',
    description: '근대 계몽기의 무게감. 낡은 양장본처럼 진한 세피아와 갈색.',
    theme: {
      bgPrimary: '#f4ece0',
      bgSecondary: '#ebe0ce',
      textPrimary: '#3b2e1e',
      textMuted: '#7a6b55',
      textDim: '#a89878',
      textBright: '#1a1208',
      accent: '#8b5e2f',
      accent2: '#a67236',
      border: '#d4c4a8',
      fontBody: 'serif',
      fontHeading: 'serif',
      animation: 'fade',
      tone: 'sepia',
      layout: 'grid',
      decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' },
    },
  },

  // 김소월 — 서정적, 연분홍/라벤더, 부드러운 톤
  {
    name: '김소월',
    slug: 'kim-sowol',
    email: 'kim-sowol@grimoire.app',
    preset: 'custom',
    description: '진달래꽃이 흩날리는 봄. 연분홍과 라벤더의 부드러운 서정.',
    theme: {
      bgPrimary: '#fdf6f8',
      bgSecondary: '#f8eef2',
      textPrimary: '#3d2b33',
      textMuted: '#8a707a',
      textDim: '#b8a0aa',
      textBright: '#1a0e14',
      accent: '#c27088',
      accent2: '#d4899e',
      border: '#e8d4dc',
      fontBody: 'serif',
      fontHeading: 'serif',
      animation: 'fade',
      tone: 'light',
      layout: 'grid',
      decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' },
    },
  },

  // 윤동주 — 밤하늘/별, 네이비/골드
  {
    name: '윤동주',
    slug: 'yun-dongju',
    email: 'yun-dongju@grimoire.app',
    preset: 'custom',
    description: '별 헤는 밤. 깊은 네이비 하늘에 금빛 별이 빛나는 고요함.',
    theme: {
      bgPrimary: '#0a0e1a',
      bgSecondary: '#101830',
      textPrimary: '#c8cad8',
      textMuted: '#6a6e88',
      textDim: '#404560',
      textBright: '#e0e2f0',
      accent: '#c8a854',
      accent2: '#e0c468',
      border: '#1e2440',
      fontBody: 'serif',
      fontHeading: 'serif',
      animation: 'fade',
      tone: 'dark',
      layout: 'grid',
      decorations: { dividerIcon: 'star', dividerColor: '#c8a854', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' },
    },
  },

  // 이상 — 모더니즘/아방가르드, 흑백 대비, 날카로운
  {
    name: '이상',
    slug: 'yi-sang',
    email: 'yi-sang@grimoire.app',
    preset: 'custom',
    description: '날개를 펴는 실험. 극단적 흑백 대비와 기하학적 차가움.',
    theme: {
      bgPrimary: '#0a0a0a',
      bgSecondary: '#141414',
      textPrimary: '#e0e0e0',
      textMuted: '#808080',
      textDim: '#505050',
      textBright: '#ffffff',
      accent: '#ff3333',
      accent2: '#cc0000',
      border: '#2a2a2a',
      fontBody: 'monospace',
      fontHeading: 'sans-serif',
      animation: 'none',
      tone: 'dark',
      layout: 'grid',
      decorations: { dividerIcon: 'line', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'none', footerText: '' },
    },
  },

  // 채만식 — 풍자/해학, 따뜻한 황토/머스타드
  {
    name: '채만식',
    slug: 'chae-mansik',
    email: 'chae-mansik@grimoire.app',
    preset: 'custom',
    description: '풍자의 붓. 따뜻한 황토빛과 머스타드의 해학적 온기.',
    theme: {
      bgPrimary: '#faf3e6',
      bgSecondary: '#f0e6cc',
      textPrimary: '#3a3020',
      textMuted: '#7a6e55',
      textDim: '#a89a78',
      textBright: '#1a1408',
      accent: '#c8961e',
      accent2: '#daa830',
      border: '#dcc898',
      fontBody: 'serif',
      fontHeading: 'sans-serif',
      animation: 'slide',
      tone: 'sepia',
      layout: 'grid',
      decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' },
    },
  },

  // 이효석 — 자연/서정, 숲녹색/크림
  {
    name: '이효석',
    slug: 'lee-hyoseok',
    email: 'lee-hyoseok@grimoire.app',
    preset: 'custom',
    description: '메밀꽃 필 무렵의 달밤. 은은한 숲녹색과 크림빛 서정.',
    theme: {
      bgPrimary: '#f5f8f2',
      bgSecondary: '#e8ede4',
      textPrimary: '#2a3528',
      textMuted: '#6a7a66',
      textDim: '#98aa94',
      textBright: '#101a0e',
      accent: '#4a7a44',
      accent2: '#5e9456',
      border: '#c8d8c4',
      fontBody: 'serif',
      fontHeading: 'serif',
      animation: 'fade',
      tone: 'light',
      layout: 'grid',
      decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' },
    },
  },

  // 김유정 — 향토적/해학, 적갈색/흙
  {
    name: '김유정',
    slug: 'kim-yujeong',
    email: 'kim-yujeong@grimoire.app',
    preset: 'custom',
    description: '봄봄의 흙내음. 적갈색 흙과 따스한 전원의 해학.',
    theme: {
      bgPrimary: '#f8f0e6',
      bgSecondary: '#ede2d2',
      textPrimary: '#382820',
      textMuted: '#7a6a58',
      textDim: '#a89480',
      textBright: '#1a100a',
      accent: '#a85a30',
      accent2: '#c46e3e',
      border: '#d8c4aa',
      fontBody: 'serif',
      fontHeading: 'serif',
      animation: 'slide',
      tone: 'sepia',
      layout: 'grid',
      decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' },
    },
  },

  // 현진건 — 사실주의, 잿빛 비 오는 거리
  {
    name: '현진건',
    slug: 'hyun-jingeon',
    email: 'hyun-jingeon@grimoire.app',
    preset: 'custom',
    description: '운수 좋은 날의 아이러니. 잿빛 비 오는 거리의 쓸쓸함.',
    theme: {
      bgPrimary: '#f0f0ee',
      bgSecondary: '#e4e4e0',
      textPrimary: '#2e2e2a',
      textMuted: '#6e6e68',
      textDim: '#a0a098',
      textBright: '#141412',
      accent: '#5a6a80',
      accent2: '#6e7e96',
      border: '#c8c8c4',
      fontBody: 'serif',
      fontHeading: 'serif',
      animation: 'fade',
      tone: 'light',
      layout: 'grid',
      decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' },
    },
  },

  // 나도향 — 낭만적 비극, 짙은 황혼
  {
    name: '나도향',
    slug: 'na-dohyang',
    email: 'na-dohyang@grimoire.app',
    preset: 'custom',
    description: '벙어리 삼룡이의 서러움. 짙은 황혼빛의 낭만적 비극.',
    theme: {
      bgPrimary: '#1a140e',
      bgSecondary: '#241c14',
      textPrimary: '#c8baa8',
      textMuted: '#7a6e5e',
      textDim: '#4e4438',
      textBright: '#e0d4c4',
      accent: '#c4884a',
      accent2: '#d49e5e',
      border: '#302820',
      fontBody: 'serif',
      fontHeading: 'serif',
      animation: 'fade',
      tone: 'dark',
      layout: 'grid',
      decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' },
    },
  },

  // 한용운 — 수묵화의 고요, 먹빛
  {
    name: '한용운',
    slug: 'han-yongun',
    email: 'han-yongun@grimoire.app',
    preset: 'custom',
    description: '님의 침묵. 먹빛 수묵화의 고요하고 단아한 기다림.',
    theme: {
      bgPrimary: '#f2f0ec',
      bgSecondary: '#e6e2da',
      textPrimary: '#282420',
      textMuted: '#686460',
      textDim: '#9a968e',
      textBright: '#0e0c0a',
      accent: '#4a4a4a',
      accent2: '#686868',
      border: '#ccc8c0',
      fontBody: 'serif',
      fontHeading: 'serif',
      animation: 'none',
      tone: 'light',
      layout: 'grid',
      decorations: { dividerIcon: 'line', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' },
    },
  },
]

// ── 메인 ──────────────────────────────────────────────

async function main() {
  console.log('=== 작가 테마 + 테스트 계정 시드 시작 ===')
  console.log(`대상 작가: ${AUTHORS.length}명\n`)

  // 비밀번호 해싱 (test1234, bcrypt 10 rounds)
  const passwordHash = await bcrypt.hash('test1234', 10)

  let success = 0
  let fail = 0

  for (const author of AUTHORS) {
    try {
      // 1. 작가 upsert (slug 기준)
      const upsertedAuthor = await prisma.author.upsert({
        where: { slug: author.slug },
        create: {
          name: author.name,
          slug: author.slug,
          email: author.email,
          passwordHash,
          credits: 10,
        },
        update: {
          email: author.email,
          passwordHash,
          credits: 10,
        },
      })

      // 2. 테마 upsert (authorId 기준 — 1:N이므로 findFirst 후 update/create)
      const existingTheme = await prisma.theme.findFirst({
        where: { authorId: upsertedAuthor.id },
      })

      if (existingTheme) {
        await prisma.theme.update({
          where: { id: existingTheme.id },
          data: {
            preset: author.preset,
            overrides: author.theme as object,
            rawDescription: author.description,
          },
        })
      } else {
        await prisma.theme.create({
          data: {
            authorId: upsertedAuthor.id,
            preset: author.preset,
            overrides: author.theme as object,
            rawDescription: author.description,
          },
        })
      }

      success++
      console.log(`  [OK] ${author.name} (${author.slug}) — ${author.email}`)
    } catch (err: any) {
      fail++
      console.error(`  [FAIL] ${author.name} (${author.slug}) — ${err.message}`)
    }
  }

  console.log(`\n=== 완료: 성공 ${success} / 실패 ${fail} / 전체 ${AUTHORS.length} ===`)
  console.log('비밀번호: test1234 (전 작가 공통)')
  console.log('크레딧: 10 (전 작가)')
}

main()
  .catch((err) => {
    console.error('치명적 오류:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
