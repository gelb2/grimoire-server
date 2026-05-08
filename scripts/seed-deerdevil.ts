/**
 * DeerDevil 콘텐츠 시드 스크립트
 *
 * 사슴악마 작가 등록 → 작품 생성 → 15개 MD 파일을 에피소드로 업로드
 *
 * 사용 시점: DeerDevil 시드 데이터를 API 경유로 등록할 때 일회성 실행
 * 전제조건: SEED_API_URL 환경변수 (미설정 시 dev 환경 기본값 사용),
 *          grimoire-web/DeerDevil_MDfiles 디렉토리 존재
 * 실행: npx tsx scripts/seed-deerdevil.ts
 */

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const API_BASE =
  process.env.SEED_API_URL ||
  'https://grimoire-server-dev.salmonsmoke-9e462011.koreacentral.azurecontainerapps.io/api'

const MD_DIR = join(__dirname, '../../grimoire-web/DeerDevil_MDfiles')

// ── 헬퍼 ──────────────────────────────────────────────

// 쿠키 저장소 — 서버가 Set-Cookie로 토큰을 전달하므로 캡처하여 재사용
let savedCookie = ''

async function request<T>(
  path: string,
  options?: RequestInit & { token?: string },
): Promise<T> {
  const { token, ...rest } = options ?? {}
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Cookie: `grimoire_token=${token}` } : {}),
    ...(savedCookie && !token ? { Cookie: savedCookie } : {}),
  }

  const url = `${API_BASE}${path}`
  console.log(`  → ${rest.method ?? 'GET'} ${url}`)

  const res = await fetch(url, { ...rest, headers })

  // Set-Cookie 헤더에서 토큰 캡처
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) {
    const match = setCookie.match(/grimoire_token=([^;]+)/)
    if (match) savedCookie = `grimoire_token=${match[1]}`
  }

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`[${res.status}] ${path} — ${body}`)
  }

  return res.json() as Promise<T>
}

// ── frontmatter 파서 ──────────────────────────────────

interface Frontmatter {
  slug: string
  type: string
  num?: string
  subtitle?: string
  description?: string
}

function parseFrontmatter(content: string): { meta: Frontmatter; body: string } {
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
    // YAML 따옴표 제거
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    meta[key] = val
  }

  return { meta: meta as unknown as Frontmatter, body }
}

// ── 에피소드 제목 추출 ────────────────────────────────

function extractTitle(body: string, meta: Frontmatter): string {
  // # 제목 라인에서 추출
  const headingMatch = body.match(/^#\s+(.+)$/m)
  if (headingMatch) return headingMatch[1].trim()

  // 폴백: 파일 메타 기반
  if (meta.type === 'preface') return '일러두기'
  if (meta.type === 'afterword') return '후기'
  return meta.slug
}

// ── 에피소드 정렬 순서 ────────────────────────────────

function sortOrder(meta: Frontmatter): number {
  if (meta.type === 'preface') return -1
  if (meta.type === 'afterword') return 999
  if (meta.type === 'bonus') return 100
  const n = parseInt(meta.num ?? '0', 10)
  return isNaN(n) ? 50 : n
}

// ── 메인 ──────────────────────────────────────────────

async function main() {
  console.log('=== DeerDevil 시드 스크립트 시작 ===')
  console.log(`API: ${API_BASE}`)
  console.log(`MD 폴더: ${MD_DIR}\n`)

  // 1. 작가 등록 (쿠키는 savedCookie에 자동 저장됨)
  console.log('[1/4] 작가 등록...')
  try {
    const registerRes = await request<{ user: any }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'deerdevil@example.com',
        password: process.env.SEED_PASSWORD ?? (() => { throw new Error('SEED_PASSWORD env 필수') })(),
        name: '사슴악마',
        slug: 'deerdevil',
      }),
    })
    console.log(`  ✓ 작가 등록 완료 (id: ${registerRes.user?.id ?? 'unknown'})\n`)
  } catch (err: any) {
    // 이미 등록된 경우 로그인 시도
    console.log(`  ⚠ 등록 실패 (이미 존재할 수 있음): ${err.message}`)
    console.log('  → 로그인으로 전환...')
    await request<{ user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'deerdevil@example.com',
        password: process.env.SEED_PASSWORD ?? (() => { throw new Error('SEED_PASSWORD env 필수') })(),
      }),
    })
    console.log(`  ✓ 로그인 완료\n`)
  }

  // 2. 작품 생성
  console.log('[2/4] 작품 생성...')
  let workId: string
  try {
    const workRes = await request<{ id: string }>('/works', {
      method: 'POST',

      body: JSON.stringify({
        title: '사슴악마',
        slug: 'deerdevil',
        description: 'A24 감성의 K-다크 판타지 단편소설 시리즈',
      }),
    })
    workId = workRes.id
    console.log(`  ✓ 작품 생성 완료 (id: ${workId})\n`)
  } catch (err: any) {
    console.log(`  ⚠ 작품 생성 실패: ${err.message}`)
    console.log('  → 기존 작품 조회 시도...')
    const spaceRes = await request<{ works?: { id: string; slug: string }[] }>('/authors/deerdevil')
    const existing = spaceRes.works?.find((w) => w.slug === 'deerdevil')
    if (!existing) throw new Error('작품을 찾을 수 없습니다')
    workId = existing.id
    console.log(`  ✓ 기존 작품 사용 (id: ${workId})\n`)
  }

  // 3. MD 파일 읽기 및 정렬
  console.log('[3/4] MD 파일 로드...')
  const files = readdirSync(MD_DIR).filter((f) => f.endsWith('.md'))
  console.log(`  ${files.length}개 파일 발견`)

  const episodes: { filename: string; meta: Frontmatter; fullContent: string; title: string }[] = []

  for (const file of files) {
    const fullContent = readFileSync(join(MD_DIR, file), 'utf-8')
    const { meta, body } = parseFrontmatter(fullContent)
    const title = extractTitle(body, meta)
    episodes.push({ filename: file, meta, fullContent, title })
  }

  // 정렬: preface → episode 1-12 → bonus → afterword
  episodes.sort((a, b) => sortOrder(a.meta) - sortOrder(b.meta))

  console.log('  정렬 순서:')
  episodes.forEach((ep, i) => {
    console.log(`    ${i + 1}. [${ep.meta.type}] ${ep.meta.slug} — ${ep.title}`)
  })
  console.log()

  // 4. 에피소드 생성
  console.log('[4/4] 에피소드 업로드...')
  let success = 0
  let fail = 0

  for (const ep of episodes) {
    try {
      const res = await request<{ id: string }>(`/works/${workId}/episodes`, {
        method: 'POST',
  
        body: JSON.stringify({
          title: ep.title,
          rawContent: ep.fullContent,
          sourceFormat: 'markdown',
        }),
      })
      success++
      console.log(`  ✓ [${ep.meta.slug}] ${ep.title} (id: ${res.id})`)
    } catch (err: any) {
      fail++
      console.log(`  ✗ [${ep.meta.slug}] ${ep.title} — ${err.message}`)
    }
  }

  console.log(`\n=== 완료: 성공 ${success} / 실패 ${fail} / 전체 ${episodes.length} ===`)
}

main().catch((err) => {
  console.error('치명적 오류:', err)
  process.exit(1)
})
