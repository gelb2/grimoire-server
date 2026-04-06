import { Injectable, Inject, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ChatRepositoryPort } from '@domain/port/outbound/chat-repository.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { ClaudeApiPort } from '@domain/port/outbound/claude-api.port'
import { PrismaService } from '@infrastructure/prisma/prisma.service'

const MEMORY_PROMPT = `다음은 소설 작가와 AI 어시스턴트 사이의 대화 기록입니다.
이 대화에서 **작품에 대해 확인된 사실**만 정리하세요.

정리 항목:
1. 캐릭터 이름, 정체, 관계 (대화에서 확인된 것만)
2. 세계관 규칙, 설정 (작가가 직접 밝힌 것만)
3. 에피소드별 핵심 정보 (제목, 주요 사건)
4. 작가의 의도, 계획 (작가가 직접 밝힌 것만)

절대 규칙:
- 추론하지 마세요. 대화에서 명시적으로 나온 정보만 정리하세요.
- AI가 분석한 의견은 제외하세요. 작가가 확인한 사실만 포함하세요.
- 마크다운 형식으로 작성하세요.`

@Injectable()
export class MemoryRegenerationService {
  private readonly logger = new Logger(MemoryRegenerationService.name)

  constructor(
    @Inject('ChatRepositoryPort') private readonly chatRepo: ChatRepositoryPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
    @Inject('ClaudeApiPort') private readonly claude: ClaudeApiPort,
    private readonly prisma: PrismaService,
  ) {}

  /** 매일 자정 (KST 00:00 = UTC 15:00) 실행 */
  @Cron('0 15 * * *')
  async regenerateAllMemories(): Promise<void> {
    this.logger.log('프로젝트 메모리 재생성 시작')

    try {
      // 오늘 대화가 있었던 세션 조회 (최근 24시간)
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const activeSessions = await this.prisma.chatSession.findMany({
        where: { updatedAt: { gte: since } },
        select: { id: true, workId: true },
      })

      // workId 기준 중복 제거
      const workIds = [...new Set(activeSessions.map(s => s.workId))]
      this.logger.log(`대화가 있었던 작품 수: ${workIds.length}`)

      for (const workId of workIds) {
        await this.regenerateWorkMemory(workId)
      }

      this.logger.log('프로젝트 메모리 재생성 완료')
    } catch (error) {
      this.logger.error('메모리 재생성 실패:', error)
    }
  }

  /** 특정 작품의 메모리 재생성 */
  async regenerateWorkMemory(workId: string): Promise<void> {
    // 해당 작품의 전체 채팅 세션에서 최근 100개 메시지 수집
    const sessions = await this.prisma.chatSession.findMany({
      where: { workId },
      select: { id: true },
    })

    const allMessages: string[] = []
    for (const session of sessions) {
      const messages = await this.chatRepo.getRecentMessages(session.id, 50)
      for (const msg of messages) {
        allMessages.push(`${msg.role === 'user' ? '작가' : 'AI'}: ${msg.content}`)
      }
    }

    if (allMessages.length === 0) return

    // 기존 context 로드
    const work = await this.workRepo.findById(workId)
    if (!work) return

    const existingContext = work.context || ''

    // Claude에게 메모리 재생성 요청
    const conversationText = allMessages.slice(-100).join('\n\n') // 최근 100개
    const prompt = existingContext
      ? `기존 프로젝트 메모리:\n${existingContext}\n\n---\n\n최근 대화:\n${conversationText}`
      : `최근 대화:\n${conversationText}`

    const newMemory = await this.claude.ask(MEMORY_PROMPT, prompt, { maxTokens: 2048 })

    // context 업데이트
    await this.workRepo.updateWork(workId, { context: newMemory })
    this.logger.log(`작품 ${workId} 메모리 업데이트 완료`)
  }
}
