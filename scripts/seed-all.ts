/**
 * 통합 시드 스크립트 — 빈 DB를 완전한 상태로 초기화
 *
 * 실행 순서:
 *   1. 작가 + 테마 생성 (seed-themes.ts 로직)
 *   2. DeerDevil 작품 + 에피소드 생성 (Prisma 직접)
 *   3. DeerDevil 에피소드 재파싱 (md-parser 사용)
 *   4. DeerDevil 에피소드 slug/type 수정
 *   5. 고전문학 작품 + 에피소드 생성 (seed-more-classics.ts 로직)
 *   6. tagline + dividerIcon 적용 (seed-theme-taglines.ts 로직)
 *   7. DeerDevil 완전한 테마 업데이트 (update-deerdevil-theme.ts 로직)
 *
 * 모든 작업은 멱등성 보장 (upsert, 존재 확인 후 생성)
 *
 * 사용법:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/seed-all.ts [--skip-deerdevil] [--skip-classics]
 */

import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  parseFrontmatter,
  parseEpisodeBlocks,
  parsePreface,
  parseAfterword,
} from '../src/lib/md-parser'
import { Block } from '../src/domain/model/block'

// ── 환경변수 검증 ──

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL 환경변수가 필요합니다.')
  console.error('사용법: DATABASE_URL="postgresql://..." npx tsx scripts/seed-all.ts [--skip-deerdevil] [--skip-classics]')
  process.exit(1)
}

const prisma = new PrismaClient()

// ── CLI 인자 파싱 ──

const args = process.argv.slice(2)
const SKIP_DEERDEVIL = args.includes('--skip-deerdevil')
const SKIP_CLASSICS = args.includes('--skip-classics')

// ── 경로 상수 ──

const MD_DIR = join(__dirname, '../../grimoire-web/DeerDevil_MDfiles')

// ══════════════════════════════════════════════════════════
// Step 1: 작가 + 테마 생성
// ══════════════════════════════════════════════════════════

interface ThemeDecorations {
  dividerIcon: string
  dividerColor: string
  headerIcon: string
  headerSubtitle: string
  cardAccentPosition: string
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
  fontBody: string
  fontHeading: string
  animation: string
  tone: string
  layout: string
  decorations: ThemeDecorations
  typingSpeed?: number
  cardRadius?: string
  navOpacity?: number
}

interface AuthorSeedData {
  name: string
  slug: string
  email: string
  theme: AuthorTheme
  preset: string
  description: string
}

const AUTHORS_WITH_THEMES: AuthorSeedData[] = [
  {
    name: '사슴악마',
    slug: 'deerdevil',
    email: 'deerdevil@grimoire.app',
    preset: 'midnight',
    description: 'A24 감성 K-다크 판타지. 어둡고 묵직한 밤의 분위기. 사슴뿔 아이콘과 타이핑 애니메이션.',
    theme: {
      bgPrimary: '#07070a', bgSecondary: '#0d0d12',
      textPrimary: '#cdc8bc', textMuted: '#7a7570', textDim: '#4a4740', textBright: '#e8e3d8',
      accent: '#9a8060', accent2: '#c4a46a', border: '#1e1e26',
      fontBody: 'serif', fontHeading: 'serif', animation: 'typing', tone: 'dark', layout: 'series',
      decorations: { dividerIcon: 'antler', dividerColor: '#9a8060', headerIcon: 'antler', headerSubtitle: 'Short Fiction Anthology', cardAccentPosition: 'left', footerText: 'Inspired by the sensibility of A24' },
      typingSpeed: 15, cardRadius: '8px', navOpacity: 0.95,
    },
  },
  {
    name: '이광수', slug: 'lee-gwangsu', email: 'lee-gwangsu@grimoire.app', preset: 'custom',
    description: '근대 계몽기의 무게감. 낡은 양장본처럼 진한 세피아와 갈색.',
    theme: { bgPrimary: '#f4ece0', bgSecondary: '#ebe0ce', textPrimary: '#3b2e1e', textMuted: '#7a6b55', textDim: '#a89878', textBright: '#1a1208', accent: '#8b5e2f', accent2: '#a67236', border: '#d4c4a8', fontBody: 'serif', fontHeading: 'serif', animation: 'fade', tone: 'sepia', layout: 'grid', decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' } },
  },
  {
    name: '김소월', slug: 'kim-sowol', email: 'kim-sowol@grimoire.app', preset: 'custom',
    description: '진달래꽃이 흩날리는 봄. 연분홍과 라벤더의 부드러운 서정.',
    theme: { bgPrimary: '#fdf6f8', bgSecondary: '#f8eef2', textPrimary: '#3d2b33', textMuted: '#8a707a', textDim: '#b8a0aa', textBright: '#1a0e14', accent: '#c27088', accent2: '#d4899e', border: '#e8d4dc', fontBody: 'serif', fontHeading: 'serif', animation: 'fade', tone: 'light', layout: 'grid', decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' } },
  },
  {
    name: '윤동주', slug: 'yun-dongju', email: 'yun-dongju@grimoire.app', preset: 'custom',
    description: '별 헤는 밤. 깊은 네이비 하늘에 금빛 별이 빛나는 고요함.',
    theme: { bgPrimary: '#0a0e1a', bgSecondary: '#101830', textPrimary: '#c8cad8', textMuted: '#6a6e88', textDim: '#404560', textBright: '#e0e2f0', accent: '#c8a854', accent2: '#e0c468', border: '#1e2440', fontBody: 'serif', fontHeading: 'serif', animation: 'fade', tone: 'dark', layout: 'grid', decorations: { dividerIcon: 'star', dividerColor: '#c8a854', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' } },
  },
  {
    name: '이상', slug: 'yi-sang', email: 'yi-sang@grimoire.app', preset: 'custom',
    description: '날개를 펴는 실험. 극단적 흑백 대비와 기하학적 차가움.',
    theme: { bgPrimary: '#0a0a0a', bgSecondary: '#141414', textPrimary: '#e0e0e0', textMuted: '#808080', textDim: '#505050', textBright: '#ffffff', accent: '#ff3333', accent2: '#cc0000', border: '#2a2a2a', fontBody: 'monospace', fontHeading: 'sans-serif', animation: 'none', tone: 'dark', layout: 'grid', decorations: { dividerIcon: 'line', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'none', footerText: '' } },
  },
  {
    name: '채만식', slug: 'chae-mansik', email: 'chae-mansik@grimoire.app', preset: 'custom',
    description: '풍자의 붓. 따뜻한 황토빛과 머스타드의 해학적 온기.',
    theme: { bgPrimary: '#faf3e6', bgSecondary: '#f0e6cc', textPrimary: '#3a3020', textMuted: '#7a6e55', textDim: '#a89a78', textBright: '#1a1408', accent: '#c8961e', accent2: '#daa830', border: '#dcc898', fontBody: 'serif', fontHeading: 'sans-serif', animation: 'slide', tone: 'sepia', layout: 'grid', decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' } },
  },
  {
    name: '이효석', slug: 'lee-hyoseok', email: 'lee-hyoseok@grimoire.app', preset: 'custom',
    description: '메밀꽃 필 무렵의 달밤. 은은한 숲녹색과 크림빛 서정.',
    theme: { bgPrimary: '#f5f8f2', bgSecondary: '#e8ede4', textPrimary: '#2a3528', textMuted: '#6a7a66', textDim: '#98aa94', textBright: '#101a0e', accent: '#4a7a44', accent2: '#5e9456', border: '#c8d8c4', fontBody: 'serif', fontHeading: 'serif', animation: 'fade', tone: 'light', layout: 'grid', decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' } },
  },
  {
    name: '김유정', slug: 'kim-yujeong', email: 'kim-yujeong@grimoire.app', preset: 'custom',
    description: '봄봄의 흙내음. 적갈색 흙과 따스한 전원의 해학.',
    theme: { bgPrimary: '#f8f0e6', bgSecondary: '#ede2d2', textPrimary: '#382820', textMuted: '#7a6a58', textDim: '#a89480', textBright: '#1a100a', accent: '#a85a30', accent2: '#c46e3e', border: '#d8c4aa', fontBody: 'serif', fontHeading: 'serif', animation: 'slide', tone: 'sepia', layout: 'grid', decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' } },
  },
  {
    name: '현진건', slug: 'hyun-jingeon', email: 'hyun-jingeon@grimoire.app', preset: 'custom',
    description: '운수 좋은 날의 아이러니. 잿빛 비 오는 거리의 쓸쓸함.',
    theme: { bgPrimary: '#f0f0ee', bgSecondary: '#e4e4e0', textPrimary: '#2e2e2a', textMuted: '#6e6e68', textDim: '#a0a098', textBright: '#141412', accent: '#5a6a80', accent2: '#6e7e96', border: '#c8c8c4', fontBody: 'serif', fontHeading: 'serif', animation: 'fade', tone: 'light', layout: 'grid', decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' } },
  },
  {
    name: '나도향', slug: 'na-dohyang', email: 'na-dohyang@grimoire.app', preset: 'custom',
    description: '벙어리 삼룡이의 서러움. 짙은 황혼빛의 낭만적 비극.',
    theme: { bgPrimary: '#1a140e', bgSecondary: '#241c14', textPrimary: '#c8baa8', textMuted: '#7a6e5e', textDim: '#4e4438', textBright: '#e0d4c4', accent: '#c4884a', accent2: '#d49e5e', border: '#302820', fontBody: 'serif', fontHeading: 'serif', animation: 'fade', tone: 'dark', layout: 'grid', decorations: { dividerIcon: 'dot', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' } },
  },
  {
    name: '한용운', slug: 'han-yongun', email: 'han-yongun@grimoire.app', preset: 'custom',
    description: '님의 침묵. 먹빛 수묵화의 고요하고 단아한 기다림.',
    theme: { bgPrimary: '#f2f0ec', bgSecondary: '#e6e2da', textPrimary: '#282420', textMuted: '#686460', textDim: '#9a968e', textBright: '#0e0c0a', accent: '#4a4a4a', accent2: '#686868', border: '#ccc8c0', fontBody: 'serif', fontHeading: 'serif', animation: 'none', tone: 'light', layout: 'grid', decorations: { dividerIcon: 'line', dividerColor: '', headerIcon: 'none', headerSubtitle: '', cardAccentPosition: 'left', footerText: '' } },
  },
]

async function step1CreateAuthorsAndThemes(): Promise<void> {
  console.log('\n══════════════════════════════════════')
  console.log('[Step 1/7] 작가 + 테마 생성')
  console.log('══════════════════════════════════════')

  const passwordHash = await bcrypt.hash('test1234', 10)
  let success = 0

  for (const a of AUTHORS_WITH_THEMES) {
    const upserted = await prisma.author.upsert({
      where: { slug: a.slug },
      create: { name: a.name, slug: a.slug, email: a.email, passwordHash, credits: 10 },
      update: { email: a.email, passwordHash, credits: 10 },
    })

    // 테마 upsert (1:N이므로 findFirst 후 update/create)
    const existingTheme = await prisma.theme.findFirst({
      where: { authorId: upserted.id },
    })

    if (existingTheme) {
      await prisma.theme.update({
        where: { id: existingTheme.id },
        data: { preset: a.preset, overrides: a.theme as object, rawDescription: a.description },
      })
    } else {
      await prisma.theme.create({
        data: { authorId: upserted.id, preset: a.preset, overrides: a.theme as object, rawDescription: a.description },
      })
    }

    success++
    console.log(`  [OK] ${a.name} (${a.slug})`)
  }

  console.log(`  완료: ${success}/${AUTHORS_WITH_THEMES.length}명`)
}

// ══════════════════════════════════════════════════════════
// Step 2: DeerDevil 작품 + 에피소드 생성
// ══════════════════════════════════════════════════════════

// 에피소드 frontmatter 파싱 (MD 파일 내장 frontmatter용)
interface SimpleFrontmatter {
  slug: string
  type: string
  num?: string
  subtitle?: string
  description?: string
}

function parseSimpleFrontmatter(content: string): { meta: SimpleFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { meta: { slug: '', type: '' }, body: content }

  const raw = match[1]
  const body = match[2]
  const meta: Record<string, string> = {}

  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let val = line.slice(idx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    meta[key] = val
  }

  return { meta: meta as unknown as SimpleFrontmatter, body }
}

function extractTitle(body: string, meta: SimpleFrontmatter): string {
  const headingMatch = body.match(/^#\s+(.+)$/m)
  if (headingMatch) return headingMatch[1].trim()
  if (meta.type === 'preface') return '일러두기'
  if (meta.type === 'afterword') return '후기'
  return meta.slug
}

function deerdevilSortOrder(type: string, num?: string): number {
  if (type === 'preface') return -1
  if (type === 'afterword') return 999
  if (type === 'bonus') {
    const n = parseInt((num ?? '').replace(/\D/g, '') || '0', 10)
    return 100 + n
  }
  const n = parseInt(num ?? '0', 10)
  return isNaN(n) ? 50 : n
}

// DeerDevil 에피소드 slug/type/orderNum 매핑
const EPISODE_MAP = [
  { match: '일러두기', slug: 'preface', type: 'preface', orderNum: 0 },
  { match: '선녀와 나무꾼', slug: 'ep1', type: 'episode', orderNum: 1 },
  { match: '여우누이전', slug: 'ep2', type: 'episode', orderNum: 2 },
  { match: '판교의 사승우', slug: 'ep3', type: 'episode', orderNum: 3 },
  { match: '금도끼', slug: 'ep4', type: 'episode', orderNum: 4 },
  { match: '개구리 왕자', slug: 'ep5', type: 'episode', orderNum: 5 },
  { match: '우렁각시', slug: 'ep6', type: 'episode', orderNum: 6 },
  { match: '바리데기', slug: 'ep7', type: 'episode', orderNum: 7 },
  { match: '손톱 먹은 쥐', slug: 'ep8', type: 'episode', orderNum: 8 },
  { match: '도리안 그레이', slug: 'ep9', type: 'episode', orderNum: 9 },
  { match: '장화홍련전', slug: 'ep10', type: 'episode', orderNum: 10 },
  { match: '이름 없는 괴물', slug: 'ep11', type: 'episode', orderNum: 11 },
  { match: '베를린 천사의 시', slug: 'ep12', type: 'episode', orderNum: 12 },
  { match: '브란덴부르크', slug: 'bonus1', type: 'bonus', orderNum: 13 },
  { match: '후기', slug: 'afterword', type: 'afterword', orderNum: 14 },
]

async function step2CreateDeerdevilWork(): Promise<void> {
  console.log('\n══════════════════════════════════════')
  console.log('[Step 2/7] DeerDevil 작품 + 에피소드 생성')
  console.log('══════════════════════════════════════')

  // 작가 찾기
  const author = await prisma.author.findUnique({ where: { slug: 'deerdevil' } })
  if (!author) throw new Error('deerdevil 작가를 찾을 수 없습니다. Step 1을 먼저 실행하세요.')

  // 작품 upsert
  let work = await prisma.work.findUnique({
    where: { authorId_slug: { authorId: author.id, slug: 'deerdevil' } },
  })

  if (!work) {
    work = await prisma.work.create({
      data: {
        authorId: author.id,
        slug: 'deerdevil',
        title: '사슴악마',
        description: 'A24 감성의 K-다크 판타지 단편소설 시리즈',
      },
    })
    console.log(`  작품 생성 완료 (id: ${work.id})`)
  } else {
    console.log(`  작품 이미 존재 (id: ${work.id})`)
  }

  // MD 파일 로드 및 정렬
  const files = readdirSync(MD_DIR).filter((f) => f.endsWith('.md'))
  console.log(`  MD 파일 ${files.length}개 발견`)

  const episodes: {
    filename: string
    meta: SimpleFrontmatter
    fullContent: string
    body: string
    title: string
    sortKey: number
  }[] = []

  for (const file of files) {
    const fullContent = readFileSync(join(MD_DIR, file), 'utf-8')
    const { meta, body } = parseSimpleFrontmatter(fullContent)
    const title = extractTitle(body, meta)
    episodes.push({
      filename: file,
      meta,
      fullContent,
      body,
      title,
      sortKey: deerdevilSortOrder(meta.type, meta.num),
    })
  }

  episodes.sort((a, b) => a.sortKey - b.sortKey)

  // 에피소드 생성 (멱등성: slug 기준 존재 확인)
  let created = 0
  let skipped = 0

  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i]
    const mapping = EPISODE_MAP.find((m) => ep.title.includes(m.match))
    const slug = mapping?.slug ?? ep.meta.slug ?? `episode-${i}`
    const type = mapping?.type ?? ep.meta.type ?? 'episode'
    const orderNum = mapping?.orderNum ?? i

    // 이미 존재하는지 확인
    const existing = await prisma.episode.findUnique({
      where: { workId_slug: { workId: work.id, slug } },
    })

    if (existing) {
      skipped++
      continue
    }

    await prisma.episode.create({
      data: {
        workId: work.id,
        slug,
        title: ep.title,
        type,
        orderNum,
        blocks: [], // Step 3에서 재파싱
        rawMd: ep.fullContent,
        sourceFormat: 'markdown',
      },
    })
    created++
  }

  console.log(`  에피소드: 생성 ${created} / 스킵(기존) ${skipped} / 전체 ${episodes.length}`)
}

// ══════════════════════════════════════════════════════════
// Step 3: DeerDevil 에피소드 재파싱
// ══════════════════════════════════════════════════════════

function parseBlocksByType(type: string, body: string): { title: string; blocks: Block[] } {
  if (type === 'preface') {
    const { paragraphs, lastLine } = parsePreface(body)
    const blocks: Block[] = []
    for (const p of paragraphs) {
      blocks.push({ type: 'paragraph', text: p })
    }
    if (lastLine) {
      blocks.push({ type: 'italic', text: lastLine })
    }
    return { title: '일러두기', blocks }
  }

  if (type === 'afterword') {
    const { glitchText, footnote } = parseAfterword(body)
    const blocks: Block[] = []
    if (glitchText) {
      blocks.push({ type: 'paragraph', text: glitchText })
    }
    if (footnote) {
      blocks.push({ type: 'divider' })
      blocks.push({ type: 'italic', text: footnote })
    }
    return { title: '후기', blocks }
  }

  return parseEpisodeBlocks(body)
}

async function step3ReparseDeerdevil(): Promise<void> {
  console.log('\n══════════════════════════════════════')
  console.log('[Step 3/7] DeerDevil 에피소드 재파싱')
  console.log('══════════════════════════════════════')

  // MD 파일 로드 및 정렬
  const files = readdirSync(MD_DIR).filter((f) => f.endsWith('.md'))
  const mdEntries: { filename: string; type: string; num?: string; body: string; sortKey: number }[] = []

  for (const file of files) {
    const content = readFileSync(join(MD_DIR, file), 'utf-8')
    const { frontmatter, body } = parseFrontmatter(content)
    mdEntries.push({
      filename: file,
      type: frontmatter.type,
      num: frontmatter.num,
      body,
      sortKey: deerdevilSortOrder(frontmatter.type, frontmatter.num),
    })
  }

  mdEntries.sort((a, b) => a.sortKey - b.sortKey)

  // DB 에피소드 조회
  const author = await prisma.author.findUnique({ where: { slug: 'deerdevil' } })
  if (!author) throw new Error('deerdevil 작가를 찾을 수 없습니다')

  const work = await prisma.work.findFirst({ where: { authorId: author.id, slug: 'deerdevil' } })
  if (!work) throw new Error('deerdevil 작품을 찾을 수 없습니다')

  const episodes = await prisma.episode.findMany({
    where: { workId: work.id },
    orderBy: { orderNum: 'asc' },
  })

  if (episodes.length !== mdEntries.length) {
    console.warn(`  경고: DB 에피소드(${episodes.length})와 MD 파일(${mdEntries.length}) 수 불일치`)
  }

  let updated = 0
  for (let i = 0; i < Math.min(episodes.length, mdEntries.length); i++) {
    const ep = episodes[i]
    const md = mdEntries[i]

    try {
      const { blocks } = parseBlocksByType(md.type, md.body)
      await prisma.episode.update({
        where: { id: ep.id },
        data: { blocks: blocks as any },
      })
      updated++
    } catch (err: any) {
      console.error(`  실패 [${ep.slug}] ${ep.title}: ${err.message}`)
    }
  }

  console.log(`  재파싱 완료: ${updated}/${episodes.length}개`)
}

// ══════════════════════════════════════════════════════════
// Step 4: DeerDevil 에피소드 slug/type 수정
// ══════════════════════════════════════════════════════════

async function step4FixDeerdevilEpisodes(): Promise<void> {
  console.log('\n══════════════════════════════════════')
  console.log('[Step 4/7] DeerDevil 에피소드 slug/type 수정')
  console.log('══════════════════════════════════════')

  const author = await prisma.author.findUnique({ where: { slug: 'deerdevil' } })
  if (!author) throw new Error('deerdevil 작가를 찾을 수 없습니다')

  const work = await prisma.work.findUnique({
    where: { authorId_slug: { authorId: author.id, slug: 'deerdevil' } },
  })
  if (!work) throw new Error('deerdevil 작품을 찾을 수 없습니다')

  const episodes = await prisma.episode.findMany({
    where: { workId: work.id },
    orderBy: { orderNum: 'asc' },
  })

  let updated = 0
  for (const ep of episodes) {
    const mapping = EPISODE_MAP.find((m) => ep.title.includes(m.match))
    if (!mapping) continue

    // 이미 올바른 slug/type/orderNum이면 스킵
    if (ep.slug === mapping.slug && ep.type === mapping.type && ep.orderNum === mapping.orderNum) {
      continue
    }

    // slug 충돌 방지를 위해 raw SQL 사용
    await prisma.$executeRawUnsafe(
      `UPDATE episodes SET slug = $1, type = $2, order_num = $3 WHERE id = $4`,
      mapping.slug,
      mapping.type,
      mapping.orderNum,
      ep.id,
    )
    updated++
  }

  console.log(`  수정 완료: ${updated}개 (전체 ${episodes.length}개)`)
}

// ══════════════════════════════════════════════════════════
// Step 5: 고전문학 작품 + 에피소드 생성
// ══════════════════════════════════════════════════════════

// seed-more-classics.ts의 작품 데이터를 동적 import로 가져올 수 없으므로
// seed-more-classics.ts를 직접 실행하는 대신, 해당 스크립트를 별도로 호출
async function step5CreateClassics(): Promise<void> {
  console.log('\n══════════════════════════════════════')
  console.log('[Step 5/7] 고전문학 작품 + 에피소드 생성')
  console.log('══════════════════════════════════════')
  console.log('  → seed-more-classics.ts 실행 중...')

  // seed-more-classics.ts를 child process로 실행
  const { execSync } = await import('child_process')
  try {
    execSync('npx tsx scripts/seed-more-classics.ts', {
      cwd: join(__dirname, '..'),
      stdio: 'inherit',
      env: { ...process.env },
    })
    console.log('  완료')
  } catch {
    console.error('  seed-more-classics.ts 실행 실패 (이미 시드된 데이터가 있을 수 있음)')
  }
}

// ══════════════════════════════════════════════════════════
// Step 6: tagline + dividerIcon 적용
// ══════════════════════════════════════════════════════════

interface TaglineData {
  slug: string
  tagline: string
  dividerIcon: string
}

const TAGLINE_DATA: TaglineData[] = [
  { slug: 'deerdevil',     tagline: '결핍은 질문을 삼킨다.',           dividerIcon: 'antler' },
  { slug: 'lee-gwangsu',   tagline: '사랑은 곧 눈물이다.',            dividerIcon: 'brush' },
  { slug: 'kim-sowol',     tagline: '나 보기가 역겨워 가실 때에는',     dividerIcon: 'flower' },
  { slug: 'yun-dongju',    tagline: '죽는 날까지 하늘을 우러러',       dividerIcon: 'star' },
  { slug: 'yi-sang',       tagline: '날개가 돋치다. 날자.',            dividerIcon: 'geometric' },
  { slug: 'chae-mansik',   tagline: '웃음 속에 칼이 있다.',            dividerIcon: 'brush' },
  { slug: 'lee-hyoseok',   tagline: '달빛에 숨은 메밀꽃',              dividerIcon: 'leaf' },
  { slug: 'kim-yujeong',   tagline: '봄이면 산골짝에',                 dividerIcon: 'camellia' },
  { slug: 'hyun-jingeon',  tagline: '운수 좋은 날이었다.',              dividerIcon: 'umbrella' },
  { slug: 'na-dohyang',    tagline: '물레방아는 돈다.',                 dividerIcon: 'waterwheel' },
]

async function step6ApplyTaglines(): Promise<void> {
  console.log('\n══════════════════════════════════════')
  console.log('[Step 6/7] tagline + dividerIcon 적용')
  console.log('══════════════════════════════════════')

  let updated = 0
  for (const data of TAGLINE_DATA) {
    const author = await prisma.author.findUnique({
      where: { slug: data.slug },
      include: { themes: true },
    })

    const theme = author?.themes[0]
    if (!theme) {
      console.log(`  [SKIP] ${data.slug} — 작가/테마 없음`)
      continue
    }

    const existingOverrides = (theme.overrides as Record<string, unknown>) ?? {}
    const existingDecorations = (existingOverrides.decorations as Record<string, unknown>) ?? {}

    const updatedOverrides = {
      ...existingOverrides,
      tagline: data.tagline,
      decorations: {
        ...existingDecorations,
        dividerIcon: data.dividerIcon,
      },
    }

    await prisma.theme.update({
      where: { id: theme.id },
      data: { overrides: updatedOverrides },
    })

    updated++
    console.log(`  [OK] ${data.slug}: "${data.tagline}"`)
  }

  console.log(`  완료: ${updated}/${TAGLINE_DATA.length}개`)
}

// ══════════════════════════════════════════════════════════
// Step 7: DeerDevil 완전한 테마 업데이트
// ══════════════════════════════════════════════════════════

const DEERDEVIL_COMPLETE_THEME = {
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
  typingSpeed: 15, cardRadius: '8px', navOpacity: 0.95,
}

async function step7UpdateDeerdevilTheme(): Promise<void> {
  console.log('\n══════════════════════════════════════')
  console.log('[Step 7/7] DeerDevil 완전한 테마 업데이트')
  console.log('══════════════════════════════════════')

  const author = await prisma.author.findUnique({
    where: { slug: 'deerdevil' },
    include: { themes: true },
  })

  if (!author) {
    console.error('  deerdevil 작가를 찾을 수 없습니다')
    return
  }

  const themeData = {
    preset: 'midnight',
    overrides: DEERDEVIL_COMPLETE_THEME as object,
    rawDescription: 'A24 감성 K-다크 판타지. 어둡고 묵직한 밤의 분위기. 사슴뿔 아이콘과 타이핑 애니메이션.',
  }

  const existingTheme = author.themes[0]
  if (existingTheme) {
    await prisma.theme.update({
      where: { id: existingTheme.id },
      data: themeData,
    })
  } else {
    await prisma.theme.create({
      data: { authorId: author.id, ...themeData },
    })
  }

  console.log(`  [OK] DeerDevil 테마 업데이트 완료`)
}

// ══════════════════════════════════════════════════════════
// 메인 실행
// ══════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════╗')
  console.log('║   ProjectGrimoire 통합 시드 스크립트    ║')
  console.log('╚══════════════════════════════════════╝')
  console.log(`DATABASE: ${process.env.DATABASE_URL?.substring(0, 40)}...`)
  console.log(`옵션: ${SKIP_DEERDEVIL ? '--skip-deerdevil ' : ''}${SKIP_CLASSICS ? '--skip-classics' : ''}`.trim() || '옵션: 없음')

  const start = Date.now()

  // Step 1: 항상 실행 (작가 + 테마는 기본)
  await step1CreateAuthorsAndThemes()

  // Step 2-4: DeerDevil 관련
  if (SKIP_DEERDEVIL) {
    console.log('\n  [SKIP] DeerDevil 단계 건너뜀 (--skip-deerdevil)')
  } else {
    await step2CreateDeerdevilWork()
    await step3ReparseDeerdevil()
    await step4FixDeerdevilEpisodes()
  }

  // Step 5: 고전문학
  if (SKIP_CLASSICS) {
    console.log('\n  [SKIP] 고전문학 단계 건너뜀 (--skip-classics)')
  } else {
    await step5CreateClassics()
  }

  // Step 6: 항상 실행 (tagline은 기존 작가에 적용)
  await step6ApplyTaglines()

  // Step 7: DeerDevil 테마 최종 업데이트
  if (!SKIP_DEERDEVIL) {
    await step7UpdateDeerdevilTheme()
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log('\n╔══════════════════════════════════════╗')
  console.log(`║   완료 (${elapsed}초)                        ║`)
  console.log('╚══════════════════════════════════════╝')
}

main()
  .catch((err) => {
    console.error('\n치명적 오류:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
