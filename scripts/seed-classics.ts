/**
 * 고전문학 시드 스크립트
 *
 * 10명의 작가 등록 → 30개 작품 생성 → 에피소드 업로드
 * 대상: 저작권 만료된 한국 근대문학 작품
 * 대상 서버: dev 환경 (Azure Container Apps)
 */

import { readFileSync, readdirSync } from 'fs'
import { join, extname, basename } from 'path'

const API_BASE =
  process.env.SEED_API_URL ||
  'https://grimoire-server-dev.salmonsmoke-9e462011.koreacentral.azurecontainerapps.io/api'

const CLASSICS_DIR = join(__dirname, '../../seed-data/classics')

// ── 작가 데이터 ──────────────────────────────────────

interface AuthorDef {
  name: string
  slug: string
  email: string
  password: string
  works: WorkDef[]
}

interface WorkDef {
  title: string
  slug: string
  description: string
  filename: string
}

const AUTHORS: AuthorDef[] = [
  {
    name: '이광수',
    slug: 'lee-gwangsu',
    email: 'lee-gwangsu@grimoire.app',
    password: 'REMOVED_CREDENTIAL_012',
    works: [
      {
        title: '무정',
        slug: 'mujeong',
        description: '한국 최초의 근대 장편소설 (1917)',
        filename: 'lee-gwangsu_mujeong.md',
      },
      {
        title: '흙',
        slug: 'heuk',
        description: '지식인의 귀농과 농촌 계몽 (1932)',
        filename: 'lee-gwangsu_heuk.txt',
      },
    ],
  },
  {
    name: '김소월',
    slug: 'kim-sowol',
    email: 'kim-sowol@grimoire.app',
    password: 'REMOVED_CREDENTIAL_012',
    works: [
      {
        title: '진달래꽃',
        slug: 'jindalraekot',
        description: '한국 근대 서정시의 최고봉 (1925)',
        filename: 'kim-sowol_jindalraekot.md',
      },
      {
        title: '엄마야 누나야',
        slug: 'eommaya-nunaya',
        description: '김소월 시 선집 (1920s)',
        filename: 'kim-sowol_eommaya-nunaya.txt',
      },
    ],
  },
  {
    name: '윤동주',
    slug: 'yun-dongju',
    email: 'yun-dongju@grimoire.app',
    password: 'REMOVED_CREDENTIAL_012',
    works: [
      {
        title: '서시',
        slug: 'seosi',
        description: '하늘과 바람과 별과 시 (1941)',
        filename: 'yun-dongju_seosi.md',
      },
      {
        title: '별 헤는 밤',
        slug: 'byeol-heneun-bam',
        description: '별 하나에 추억과 사랑을 담은 시 (1941)',
        filename: 'yun-dongju_byeol-heneun-bam.md',
      },
      {
        title: '십자가',
        slug: 'sipjaga',
        description: '윤동주 시 선집 (1941)',
        filename: 'yun-dongju_sipjaga.txt',
      },
    ],
  },
  {
    name: '이상',
    slug: 'yi-sang',
    email: 'yi-sang@grimoire.app',
    password: 'REMOVED_CREDENTIAL_012',
    works: [
      {
        title: '날개',
        slug: 'nalgae',
        description: '박제가 되어버린 천재의 독백 (1936)',
        filename: 'yi-sang_nalgae.md',
      },
      {
        title: '오감도',
        slug: 'ogamdo',
        description: '한국 모더니즘 시의 원점 (1934)',
        filename: 'yi-sang_ogamdo.txt',
      },
    ],
  },
  {
    name: '현진건',
    slug: 'hyun-jingeon',
    email: 'hyun-jingeon@grimoire.app',
    password: 'REMOVED_CREDENTIAL_012',
    works: [
      {
        title: '운수 좋은 날',
        slug: 'unsu-joheun-nal',
        description: '아이러니 기법의 정수 (1924)',
        filename: 'hyun-jingeon_unsu-joheun-nal.md',
      },
      {
        title: '빈처',
        slug: 'bincheo',
        description: '가난한 지식인의 결혼 생활 (1921)',
        filename: 'hyun-jingeon_bincheo.txt',
      },
      {
        title: '술 권하는 사회',
        slug: 'sul-gwonhaneun-sahoe',
        description: '일제 강점기 지식인의 절망 (1921)',
        filename: 'hyun-jingeon_sul-gwonhaneun-sahoe.md',
      },
    ],
  },
  {
    name: '나도향',
    slug: 'na-dohyang',
    email: 'na-dohyang@grimoire.app',
    password: 'REMOVED_CREDENTIAL_012',
    works: [
      {
        title: '벙어리 삼룡이',
        slug: 'beongeori-samryongi',
        description: '벙어리 머슴의 순박한 사랑과 비극 (1925)',
        filename: 'na-dohyang_beongeori-samryongi.md',
      },
      {
        title: '뽕',
        slug: 'ppong',
        description: '뽕밭에서의 만남과 이별 (1925)',
        filename: 'na-dohyang_ppong.txt',
      },
    ],
  },
  {
    name: '한용운',
    slug: 'han-yongun',
    email: 'han-yongun@grimoire.app',
    password: 'REMOVED_CREDENTIAL_012',
    works: [
      {
        title: '님의 침묵',
        slug: 'nimui-chimmuk',
        description: '사랑과 독립의 염원 (1926)',
        filename: 'han-yongun_nimui-chimmuk.md',
      },
      {
        title: '알 수 없어요',
        slug: 'al-su-eopseooyo',
        description: '존재에 대한 물음 (1926)',
        filename: 'han-yongun_al-su-eopseooyo.txt',
      },
      {
        title: '나룻배와 행인',
        slug: 'narutbae-wa-haengin',
        description: '기다림의 미학 (1926)',
        filename: 'han-yongun_narutbae-wa-haengin.txt',
      },
    ],
  },
  {
    name: '김유정',
    slug: 'kim-yujeong',
    email: 'kim-yujeong@grimoire.app',
    password: 'REMOVED_CREDENTIAL_012',
    works: [
      {
        title: '봄봄',
        slug: 'bombom',
        description: '데릴사위의 해학적 이야기 (1935)',
        filename: 'kim-yujeong_bombom.md',
      },
      {
        title: '동백꽃',
        slug: 'dongbaekkot',
        description: '동백꽃 향기 속의 순박한 사랑 (1936)',
        filename: 'kim-yujeong_dongbaekkot.md',
      },
      {
        title: '만무방',
        slug: 'manmubang',
        description: '어찌할 도리가 없는 가난 (1935)',
        filename: 'kim-yujeong_manmubang.txt',
      },
      {
        title: '금 따는 콩밭',
        slug: 'geum-ttaneun-kongbat',
        description: '콩밭에서 꿈꾸는 사랑 (1935)',
        filename: 'kim-yujeong_geum-ttaneun-kongbat.txt',
      },
    ],
  },
  {
    name: '이효석',
    slug: 'lee-hyoseok',
    email: 'lee-hyoseok@grimoire.app',
    password: 'REMOVED_CREDENTIAL_012',
    works: [
      {
        title: '메밀꽃 필 무렵',
        slug: 'memilkkot-pil-muryeop',
        description: '달밤 메밀꽃밭의 서정 (1936)',
        filename: 'lee-hyoseok_memilkkot-pil-muryeop.md',
      },
      {
        title: '돈',
        slug: 'don',
        description: '돈에 옥죄이는 농촌 (1933)',
        filename: 'lee-hyoseok_don.txt',
      },
      {
        title: '산',
        slug: 'san',
        description: '산과 함께 사는 사람의 이야기 (1936)',
        filename: 'lee-hyoseok_san.txt',
      },
    ],
  },
  {
    name: '채만식',
    slug: 'chae-mansik',
    email: 'chae-mansik@grimoire.app',
    password: 'REMOVED_CREDENTIAL_012',
    works: [
      {
        title: '탁류',
        slug: 'tangniu',
        description: '금강 하류의 비극 (1937)',
        filename: 'chae-mansik_tangniu.md',
      },
      {
        title: '태평천하',
        slug: 'taepyeongcheonha',
        description: '기득권층 풍자 (1938)',
        filename: 'chae-mansik_taepyeongcheonha.md',
      },
      {
        title: '레디메이드 인생',
        slug: 'redimeideu-insaeng',
        description: '식민지 지식인의 실업 (1934)',
        filename: 'chae-mansik_redimeideu-insaeng.txt',
      },
      {
        title: '치숙',
        slug: 'chisuk',
        description: '지식인의 위선과 자기모순 (1938)',
        filename: 'chae-mansik_chisuk.md',
      },
      {
        title: '미스터 방',
        slug: 'miseuteo-bang',
        description: '유학파 청년의 허세 (1946)',
        filename: 'chae-mansik_miseuteo-bang.txt',
      },
      {
        title: '논 이야기',
        slug: 'non-iyagi',
        description: '소작제도의 모순을 담은 수필 (1940)',
        filename: 'chae-mansik_non-iyagi.md',
      },
    ],
  },
]

// ── 헬퍼 ──────────────────────────────────────────────

async function request<T>(
  path: string,
  options?: RequestInit & { token?: string },
): Promise<T> {
  const { token, ...rest } = options ?? {}
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  const url = `${API_BASE}${path}`

  const res = await fetch(url, { ...rest, headers })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`[${res.status}] ${path} — ${body}`)
  }

  return res.json() as Promise<T>
}

// ── 파일 읽기 헬퍼 ───────────────────────────────────

function readSeedFile(filename: string): { content: string; sourceFormat: string } {
  const filepath = join(CLASSICS_DIR, filename)
  const content = readFileSync(filepath, 'utf-8')
  const ext = extname(filename).toLowerCase()

  // 파일 확장자에 따른 sourceFormat 결정
  const sourceFormat = ext === '.md' ? 'markdown' : 'txt'

  return { content, sourceFormat }
}

// ── 작가 등록/로그인 ─────────────────────────────────

async function registerOrLogin(author: AuthorDef): Promise<string> {
  try {
    const res = await request<{ user: any; token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: author.email,
        password: author.password,
        name: author.name,
        slug: author.slug,
      }),
    })
    return res.token
  } catch {
    // 이미 등록된 경우 로그인
    const res = await request<{ user: any; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: author.email,
        password: author.password,
      }),
    })
    return res.token
  }
}

// ── 작품 생성 ────────────────────────────────────────

async function createWork(
  token: string,
  authorSlug: string,
  work: WorkDef,
): Promise<string> {
  try {
    const res = await request<{ id: string }>('/works', {
      method: 'POST',
      token,
      body: JSON.stringify({
        title: work.title,
        slug: work.slug,
        description: work.description,
      }),
    })
    return res.id
  } catch (err: any) {
    // 이미 존재하는 경우 기존 작품 조회
    console.log(`    -> 이미 존재할 수 있음, 조회 시도...`)
    const spaceRes = await request<{ works?: { id: string; slug: string }[] }>(
      `/authors/${authorSlug}`,
    )
    const existing = spaceRes.works?.find((w) => w.slug === work.slug)
    if (!existing) throw new Error(`작품 생성/조회 실패: ${err.message}`)
    return existing.id
  }
}

// ── 에피소드 생성 ────────────────────────────────────

async function createEpisode(
  token: string,
  workId: string,
  work: WorkDef,
): Promise<string> {
  const { content, sourceFormat } = readSeedFile(work.filename)

  const res = await request<{ id: string }>(`/works/${workId}/episodes`, {
    method: 'POST',
    token,
    body: JSON.stringify({
      title: work.title,
      rawContent: content,
      sourceFormat,
    }),
  })

  return res.id
}

// ── 메인 ──────────────────────────────────────────────

async function main() {
  console.log('=== 고전문학 시드 스크립트 시작 ===')
  console.log(`API: ${API_BASE}`)
  console.log(`시드 폴더: ${CLASSICS_DIR}`)
  console.log(`작가 수: ${AUTHORS.length}`)
  console.log(`작품 수: ${AUTHORS.reduce((sum, a) => sum + a.works.length, 0)}`)
  console.log()

  // 파일 존재 확인
  const files = readdirSync(CLASSICS_DIR)
  console.log(`[사전 확인] 시드 파일 ${files.length}개 발견`)
  for (const author of AUTHORS) {
    for (const work of author.works) {
      if (!files.includes(work.filename)) {
        console.error(`  !! 파일 누락: ${work.filename}`)
        process.exit(1)
      }
    }
  }
  console.log('  모든 파일 확인 완료\n')

  // 통계
  let authorSuccess = 0
  let authorFail = 0
  let workSuccess = 0
  let workFail = 0
  let episodeSuccess = 0
  let episodeFail = 0

  for (const author of AUTHORS) {
    console.log(`\n[작가] ${author.name} (${author.slug})`)

    // 1. 작가 등록/로그인
    let token: string
    try {
      token = await registerOrLogin(author)
      authorSuccess++
      console.log(`  -> 인증 성공`)
    } catch (err: any) {
      authorFail++
      console.error(`  !! 인증 실패: ${err.message}`)
      continue
    }

    // 2. 각 작품 생성 + 에피소드 업로드
    for (const work of author.works) {
      console.log(`  [작품] ${work.title} (${work.slug})`)

      // 작품 생성
      let workId: string
      try {
        workId = await createWork(token, author.slug, work)
        workSuccess++
        console.log(`    -> 작품 생성 완료 (id: ${workId})`)
      } catch (err: any) {
        workFail++
        console.error(`    !! 작품 생성 실패: ${err.message}`)
        continue
      }

      // 에피소드 업로드
      try {
        const episodeId = await createEpisode(token, workId, work)
        episodeSuccess++
        console.log(`    -> 에피소드 업로드 완료 (id: ${episodeId})`)
      } catch (err: any) {
        episodeFail++
        console.error(`    !! 에피소드 업로드 실패: ${err.message}`)
      }
    }
  }

  // 결과 요약
  console.log('\n========================================')
  console.log('=== 고전문학 시드 결과 ===')
  console.log('========================================')
  console.log(`작가:    성공 ${authorSuccess} / 실패 ${authorFail} / 전체 ${AUTHORS.length}`)
  console.log(`작품:    성공 ${workSuccess} / 실패 ${workFail} / 전체 ${AUTHORS.reduce((s, a) => s + a.works.length, 0)}`)
  console.log(`에피소드: 성공 ${episodeSuccess} / 실패 ${episodeFail} / 전체 ${AUTHORS.reduce((s, a) => s + a.works.length, 0)}`)
  console.log('========================================')
}

main().catch((err) => {
  console.error('치명적 오류:', err)
  process.exit(1)
})
