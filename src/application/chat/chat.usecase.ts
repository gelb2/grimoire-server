import { Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common'
import { ChatRepositoryPort, ChatSession, ChatMessage } from '@domain/port/outbound/chat-repository.port'
import { VectorStorePort } from '@domain/port/outbound/vector-store.port'
import { EmbeddingPort } from '@domain/port/outbound/embedding.port'
import { ClaudeApiPort } from '@domain/port/outbound/claude-api.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { guardPromptInjection } from '@lib/prompt-injection-guard'

const CHAT_SYSTEM_PROMPT = `당신은 소설 작가를 돕는 AI 어시스턴트입니다.

=== 절대 규칙 ===
1. 원고에 명시적으로 나오는 정보만 답변하세요.
2. 추론이나 상상으로 캐릭터 이름, 배경, 사건을 만들어내지 마세요.
3. 원고에서 확인할 수 없는 정보는 반드시 "원고에서 확인되지 않습니다"라고 답하세요.
4. "~일 것이다", "~로 추정된다" 같은 추측 표현을 사용하지 마세요.

=== 역할 ===
- 작가가 질문하면 원고 맥락에 근거해서만 답변
- 캐릭터 분석, 설정 일관성 점검, 문체 조언, 플롯 제안
- 작가의 원고를 존중하되, 개선점은 구체적으로 제시`

@Injectable()
export class ChatUseCase {
  constructor(
    @Inject('ChatRepositoryPort') private readonly chatRepo: ChatRepositoryPort,
    @Inject('VectorStorePort') private readonly vectorStore: VectorStorePort,
    @Inject('EmbeddingPort') private readonly embedding: EmbeddingPort,
    @Inject('ClaudeApiPort') private readonly claude: ClaudeApiPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
  ) {}

  /** 새 채팅 세션 생성 */
  async createSession(authorId: string, workId: string, title?: string): Promise<ChatSession> {
    return this.chatRepo.createSession(authorId, workId, title)
  }

  /** 세션 목록 조회 */
  async listSessions(authorId: string, workId: string): Promise<ChatSession[]> {
    return this.chatRepo.findSessionsByAuthorAndWork(authorId, workId)
  }

  /** 메시지 전송 + AI 응답 생성 */
  async sendMessage(authorId: string, sessionId: string, userMessage: string): Promise<{ userMsg: ChatMessage; assistantMsg: ChatMessage }> {
    // P17 — LLM Prompt Injection 방어 (OWASP LLM01, Constitution 19 Principles)
    // 검출 시 BadRequestException — 클라이언트에 자연스러운 문장 재작성 요구
    guardPromptInjection(userMessage, 'chat.sendMessage')

    const session = await this.chatRepo.findSessionById(sessionId)
    if (!session) throw new NotFoundException('채팅 세션을 찾을 수 없습니다')
    if (session.authorId !== authorId) throw new ForbiddenException('본인의 채팅만 사용할 수 있습니다')

    // 1. 사용자 메시지 저장
    const userMsg = await this.chatRepo.addMessage(sessionId, 'user', userMessage)

    // 2. Work의 context + instructions + 에피소드 매니페스트 로드
    let workContext = ''
    let workInstructions = ''
    let episodeManifest = ''
    try {
      const work = await this.workRepo.findById(session.workId)
      if (work?.context) workContext = work.context
      if (work?.instructions) workInstructions = work.instructions

      // 에피소드 매니페스트 자동 생성 (DB에서 읽기)
      const episodes = await this.workRepo.findEpisodes(session.workId)
      if (episodes.length > 0) {
        episodeManifest = episodes
          .map(ep => `${ep.type === 'episode' ? `ep${ep.orderNum}` : ep.type}: ${ep.title}`)
          .join('\n')
      }
    } catch { /* 무시 */ }

    // 3. RAG: 질문 임베딩 → 관련 원고 청크 검색 (25개로 증가)
    let ragContext = ''
    try {
      const queryEmbedding = await this.embedding.getEmbedding(userMessage)
      const chunks = await this.vectorStore.searchSimilar(queryEmbedding, 25, session.workId)
      if (chunks.length > 0) {
        ragContext = chunks.map(c => c.chunkText).join('\n\n---\n\n')
      }
    } catch {
      // 인덱싱 안 된 작품이면 맥락 없이 진행
    }

    // 4. 대화 히스토리 (최근 10개)
    const history = await this.chatRepo.getRecentMessages(sessionId, 10)
    const historyText = history
      .filter(m => m.id !== userMsg.id)
      .map(m => `${m.role === 'user' ? '작가' : 'AI'}: ${m.content}`)
      .join('\n\n')

    // 5. 시스템 프롬프트 조립: 고정 지침 + 매니페스트 + 맥락 + 지침
    let systemPrompt = CHAT_SYSTEM_PROMPT
    if (episodeManifest) {
      systemPrompt += `\n\n=== 이 작품의 에피소드 목록 (정확히 이것만 존재함, 이 목록에 없는 에피소드를 만들지 마라) ===\n${episodeManifest}`
    }
    if (workContext) {
      systemPrompt += `\n\n=== 프로젝트 메모리 (AI가 축적한 작품 정보) ===\n${workContext}`
    }
    if (workInstructions) {
      systemPrompt += `\n\n=== 작품 지침 (항상 따를 것) ===\n${workInstructions}`
    }
    if (ragContext) {
      systemPrompt += `\n\n=== 원고에서 검색된 관련 부분 ===\n${ragContext}`
    }

    // 6. 사용자 메시지 조립
    const fullPrompt = [
      historyText ? `[이전 대화]\n${historyText}\n\n` : '',
      `작가: ${userMessage}`,
    ].join('')

    const aiResponse = await this.claude.ask(systemPrompt, fullPrompt, { maxTokens: 2048 })

    // 7. AI 응답 저장
    const assistantMsg = await this.chatRepo.addMessage(sessionId, 'assistant', aiResponse)

    return { userMsg, assistantMsg }
  }

  /** 메시지 히스토리 (커서 기반 페이지네이션) */
  async getMessages(authorId: string, sessionId: string, limit: number, cursor?: string): Promise<ChatMessage[]> {
    const session = await this.chatRepo.findSessionById(sessionId)
    if (!session) throw new NotFoundException('채팅 세션을 찾을 수 없습니다')
    if (session.authorId !== authorId) throw new ForbiddenException('본인의 채팅만 조회할 수 있습니다')

    return this.chatRepo.getMessages(sessionId, limit, cursor)
  }

  /** 세션 삭제 */
  async deleteSession(authorId: string, sessionId: string): Promise<void> {
    const session = await this.chatRepo.findSessionById(sessionId)
    if (!session) throw new NotFoundException('채팅 세션을 찾을 수 없습니다')
    if (session.authorId !== authorId) throw new ForbiddenException('본인의 채팅만 삭제할 수 있습니다')

    await this.chatRepo.deleteSession(sessionId)
  }
}
