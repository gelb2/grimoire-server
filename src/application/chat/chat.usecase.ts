import { Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common'
import { ChatRepositoryPort, ChatSession, ChatMessage } from '@domain/port/outbound/chat-repository.port'
import { VectorStorePort } from '@domain/port/outbound/vector-store.port'
import { EmbeddingPort } from '@domain/port/outbound/embedding.port'
import { ClaudeApiPort } from '@domain/port/outbound/claude-api.port'

const CHAT_SYSTEM_PROMPT = `당신은 소설 작가를 돕는 AI 어시스턴트입니다.
작가의 작품 원고 맥락을 참고하여, 질문에 정확하고 유용하게 답변하세요.

역할:
- 캐릭터 분석, 설정 일관성 점검, 문체 조언, 플롯 제안
- 작가의 원고를 존중하되, 개선점은 구체적으로 제시
- 원고에 없는 내용을 만들어내지 말 것 — 모르면 "원고에서 확인되지 않습니다"라고 답변

아래는 작가의 원고에서 질문과 관련된 부분입니다:`

@Injectable()
export class ChatUseCase {
  constructor(
    @Inject('ChatRepositoryPort') private readonly chatRepo: ChatRepositoryPort,
    @Inject('VectorStorePort') private readonly vectorStore: VectorStorePort,
    @Inject('EmbeddingPort') private readonly embedding: EmbeddingPort,
    @Inject('ClaudeApiPort') private readonly claude: ClaudeApiPort,
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
    const session = await this.chatRepo.findSessionById(sessionId)
    if (!session) throw new NotFoundException('채팅 세션을 찾을 수 없습니다')
    if (session.authorId !== authorId) throw new ForbiddenException('본인의 채팅만 사용할 수 있습니다')

    // 1. 사용자 메시지 저장
    const userMsg = await this.chatRepo.addMessage(sessionId, 'user', userMessage)

    // 2. RAG: 질문 임베딩 → 관련 원고 청크 검색
    let context = ''
    try {
      const queryEmbedding = await this.embedding.getEmbedding(userMessage)
      const chunks = await this.vectorStore.searchSimilar(queryEmbedding, 15, session.workId)
      if (chunks.length > 0) {
        context = chunks.map(c => c.chunkText).join('\n\n---\n\n')
      }
    } catch {
      // 인덱싱 안 된 작품이면 맥락 없이 진행
    }

    // 3. 대화 히스토리 (최근 10개)
    const history = await this.chatRepo.getRecentMessages(sessionId, 10)
    const historyText = history
      .filter(m => m.id !== userMsg.id) // 방금 저장한 메시지 제외
      .map(m => `${m.role === 'user' ? '작가' : 'AI'}: ${m.content}`)
      .join('\n\n')

    // 4. Claude에 전달
    const fullPrompt = [
      context ? `[원고 맥락]\n${context}\n\n` : '',
      historyText ? `[이전 대화]\n${historyText}\n\n` : '',
      `작가: ${userMessage}`,
    ].join('')

    const aiResponse = await this.claude.ask(CHAT_SYSTEM_PROMPT, fullPrompt, { maxTokens: 2048 })

    // 5. AI 응답 저장
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
