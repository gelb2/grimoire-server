import { Injectable, Inject, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ChatRepositoryPort } from '@domain/port/outbound/chat-repository.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { ClaudeApiPort } from '@domain/port/outbound/claude-api.port'

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
  ) {}

  /** 매일 자정 (KST 00:00 = UTC 15:00) 실행 */
  @Cron('0 15 * * *')
  async regenerateAllMemories(): Promise<void> {
    this.logger.log('프로젝트 메모리 재생성 시작')

    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const activeSessions = await this.chatRepo.findActiveSessionsSince(since)

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
    const sessionIds = await this.chatRepo.findSessionIdsByWorkId(workId)

    const allMessages: string[] = []
    for (const sessionId of sessionIds) {
      const messages = await this.chatRepo.getRecentMessages(sessionId, 50)
      for (const msg of messages) {
        allMessages.push(`${msg.role === 'user' ? '작가' : 'AI'}: ${msg.content}`)
      }
    }

    if (allMessages.length === 0) return

    const work = await this.workRepo.findById(workId)
    if (!work) return

    const existingContext = work.context || ''
    const conversationText = allMessages.slice(-100).join('\n\n')
    const prompt = existingContext
      ? `기존 프로젝트 메모리:\n${existingContext}\n\n---\n\n최근 대화:\n${conversationText}`
      : `최근 대화:\n${conversationText}`

    const newMemory = await this.claude.ask(MEMORY_PROMPT, prompt, { maxTokens: 2048 })
    await this.workRepo.updateWork(workId, { context: newMemory })
    this.logger.log(`작품 ${workId} 메모리 업데이트 완료`)
  }
}
