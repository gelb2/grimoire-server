/** 로컬 최초 1회 전용 가상 원고. 실제 작가·외부 파일·API를 사용하지 않는다. */
import { PrismaClient, Prisma } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { requireLocalSeedTarget } from '../src/infrastructure/config/local-seed-target'
import { parseEpisodeBlocks } from '../src/lib/md-parser'

async function main() {
  const url = requireLocalSeedTarget('DATABASE_URL', ['postgresql:', 'postgres:'])
  const password = process.env.SEED_PASSWORD
  if (!password || password.length < 12) throw new Error('SEED_PASSWORD는 12자 이상 필요합니다')
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    const passwordHash = await bcrypt.hash(password, 10)
    await prisma.$transaction(async (tx) => {
      if (await tx.author.count()) throw new Error('빈 로컬 DB에서만 가상 시드를 실행할 수 있습니다')
      for (const [index, slug] of ['local-writer', 'local-reader'].entries()) {
        const preset = index === 0 ? 'midnight' : 'morning'
        const systemTheme = await tx.theme.findFirst({
          where: { authorId: null, source: 'system', preset },
        })
        if (!systemTheme?.overrides) throw new Error('시스템 프리셋 마이그레이션이 필요합니다')
        const author = await tx.author.create({ data: {
          slug, email: `${index === 0 ? 'writer' : 'reader'}@example.test`,
          name: index === 0 ? '가상 작가' : '가상 독자', passwordHash,
          pointsFree: 3000,
        } })
        await tx.creditLedger.create({ data: {
          authorId: author.id, source: 'free', type: 'earn', amount: 3000,
          balanceAfter: 3000, reason: 'local_demo_seed',
        } })
        const theme = await tx.theme.create({ data: {
          authorId: author.id, name: index === 0 ? '밤의 연습' : '아침의 연습',
          preset, overrides: systemTheme.overrides as Prisma.InputJsonValue,
          source: 'user', isSlotted: true,
        } })
        await tx.author.update({ where: { id: author.id }, data: { defaultThemeId: theme.id } })
        const work = await tx.work.create({ data: {
          authorId: author.id, slug: 'sample-notebook', title: `가상 원고 ${index + 1}`,
          description: '로컬 기능 확인을 위해 작성한 예시입니다.', themeId: theme.id,
        } })
        for (const orderNum of [1, 2]) {
          const rawMd = `# ${orderNum}장. 빈 공책\n\n작은 책상 위에 빈 공책이 놓여 있었다.\n\n“오늘은 어떤 이야기를 적을까?”\n\n* * *\n\n창문으로 들어온 빛이 다음 장을 비췄다.`
          const parsed = parseEpisodeBlocks(rawMd)
          await tx.episode.create({ data: {
            workId: work.id, slug: `chapter-${orderNum}`, title: `${orderNum}장. 빈 공책`,
            orderNum, rawMd, blocks: JSON.parse(JSON.stringify(parsed.blocks)),
            status: 'public', sourceFormat: 'markdown',
          } })
        }
      }
    })
    console.log('가상 계정·원고·테마·무료 포인트 원장 생성 완료. 비밀번호 출력 생략.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(() => {
  console.error('가상 시드 실패. 빈 로컬 DB와 필수 설정을 확인하세요.')
  process.exitCode = 1
})
