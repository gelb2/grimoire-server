import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://grimoireadmin:REMOVED_CREDENTIAL_009@grimoire-db-dev.postgres.database.azure.com:5432/grimoire?sslmode=require'
    }
  }
})

// 한글 → 로마자 매핑
const slugMap: Record<string, string> = {
  '서시': 'seosi',
  '별 헤는 밤': 'byeol-heneun-bam',
  '십자가': 'sipjaga',
  '무정': 'mujeong',
  '흙': 'heuk',
  '진달래꽃': 'jindallae-kkot',
  '엄마야 누나야': 'eommaya-nunaya',
  '날개': 'nalgae',
  '오감도': 'ogamdo',
  '님의 침묵': 'nimui-chimmuk',
  '알 수 없어요': 'al-su-eopseoyo',
  '금 따는 콩밭': 'geum-ttaneun-kongbat',
  '동백꽃': 'dongbaek-kkot',
  '봄봄': 'bombom',
  '메밀꽃 필 무렵': 'memilkkot-pil-muryeop',
  '산': 'san',
  '돈': 'don',
  '논 이야기': 'non-iyagi',
  '미스터 방': 'miseuteo-bang',
  '치숙': 'chisuk',
  '레디메이드 인생': 'readymade-insaeng',
  '태평천하': 'taepyeongcheonha',
  '탁류': 'tangnyu',
  '사슴악마': 'deerdevil',
}

async function main() {
  const episodes = await prisma.episode.findMany()
  let fixed = 0
  for (const ep of episodes) {
    const hasKorean = /[가-힣]/.test(ep.slug)
    if (hasKorean) {
      const newSlug = slugMap[ep.slug] || `episode-${ep.orderNum}`
      await prisma.episode.update({
        where: { id: ep.id },
        data: { slug: newSlug }
      })
      console.log(`${ep.slug} → ${newSlug}`)
      fixed++
    }
  }
  
  // frontmatter도 블록에서 제거
  const allEps = await prisma.episode.findMany()
  let blockFixed = 0
  for (const ep of allEps) {
    const blocks = ep.blocks as any[]
    if (!blocks || blocks.length === 0) continue
    
    // frontmatter 패턴 제거: separator → key: value paragraphs → separator
    let startIdx = -1
    let endIdx = -1
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].type === 'separator') {
        if (startIdx === -1) {
          startIdx = i
        } else {
          endIdx = i
          break
        }
      }
    }
    
    if (startIdx === 0 && endIdx > 0) {
      // Check if blocks between separators look like frontmatter
      const between = blocks.slice(startIdx + 1, endIdx)
      const isFrontmatter = between.every((b: any) => 
        b.type === 'paragraph' && b.text && /^[a-z]+:/.test(b.text)
      )
      if (isFrontmatter) {
        const newBlocks = blocks.slice(endIdx + 1)
        await prisma.episode.update({
          where: { id: ep.id },
          data: { blocks: newBlocks }
        })
        console.log(`블록 정리: ${ep.title} (${between.length}개 frontmatter 제거)`)
        blockFixed++
      }
    }
  }
  
  console.log(`\n완료: slug ${fixed}개 수정, 블록 ${blockFixed}개 정리`)
  await prisma.$disconnect()
}

main().catch(console.error)
