import { PrismaClient } from '@prisma/client'
import { parseEpisodeBlocks, parseFrontmatter } from '../src/lib/md-parser'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://grimoireadmin:REMOVED_CREDENTIAL_009@grimoire-db-dev.postgres.database.azure.com:5432/grimoire?sslmode=require'
    }
  }
})

async function main() {
  // DeerDevil 에피소드의 원본 MD 파일들로 재파싱
  const mdDir = path.join(__dirname, '../../grimoire-web/content')
  
  if (!fs.existsSync(mdDir)) {
    console.log('MD 파일 디렉토리 없음:', mdDir)
    console.log('웹 프로젝트에서 사슴악마 MD 파일을 찾습니다...')
    
    // grimoire-web의 content 디렉토리 찾기
    const altDirs = [
      path.join(__dirname, '../../grimoire-web/content'),
      path.join(__dirname, '../../grimoire-web/public/content'),
      path.join(__dirname, '../../deerDevil/content'),
    ]
    
    for (const d of altDirs) {
      if (fs.existsSync(d)) {
        console.log('발견:', d)
        const files = fs.readdirSync(d).filter(f => f.endsWith('.md'))
        console.log('MD 파일:', files.length, '개')
      }
    }
    return
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
