import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common'
import { ChatRepositoryPort, ChatSession, ChatMessage } from '@domain/port/outbound/chat-repository.port'
import { VectorStorePort } from '@domain/port/outbound/vector-store.port'
import { EmbeddingPort } from '@domain/port/outbound/embedding.port'
import { ClaudeApiPort } from '@domain/port/outbound/claude-api.port'
import { WorkRepositoryPort } from '@domain/port/outbound/work-repository.port'
import { ChargePointsUseCase } from '@application/credit/charge-points.usecase'
import { AuditLogService } from '@application/admin/audit-log.service'
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
  private readonly logger = new Logger(ChatUseCase.name)

  constructor(
    @Inject('ChatRepositoryPort') private readonly chatRepo: ChatRepositoryPort,
    @Inject('VectorStorePort') private readonly vectorStore: VectorStorePort,
    @Inject('EmbeddingPort') private readonly embedding: EmbeddingPort,
    @Inject('ClaudeApiPort') private readonly claude: ClaudeApiPort,
    @Inject('WorkRepositoryPort') private readonly workRepo: WorkRepositoryPort,
    /**
     * 크레딧 개편 I Phase (2026-05-17) — 채팅 4구간 사후 차감.
     * Optional — 실 운영(app.module)에서는 항상 주입. 미주입 시 차감 skip (BACKWARD COMPATIBLE).
     */
    @Optional()
    private readonly chargePoints: ChargePointsUseCase | null = null,
    /**
     * F-11 (2026-07-11) — 채팅 사후 차감 유실 시 재조정 근거 박제용 (durable AuditLog).
     * Optional — 실 운영(app.module)에서는 주입, spec 미주입 시 로그만 (BACKWARD COMPATIBLE).
     */
    @Optional()
    private readonly auditLog: AuditLogService | null = null,
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

    // 크레딧 개편 I Phase — 외상 상한 도달 시 신규 채팅 사전 차단 (게이트 5(c)).
    // 사후 차감 구조이므로 응답 자체는 생성되지만, 외상이 상한이면 충전 유도.
    if (this.chargePoints) {
      const blocked = await this.chargePoints.isChatBlocked(authorId)
      if (blocked) {
        throw new ForbiddenException(
          '미결제 포인트가 한도에 도달했습니다. 포인트를 충전해 주세요.',
        )
      }
    }

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

    // 크레딧 개편 I Phase — askWithUsage 로 토큰 usage 수신 (4구간 사후 차감 입력)
    const aiResult = await this.claude.askWithUsage(systemPrompt, fullPrompt, {
      maxTokens: 2048,
    })

    // 7. AI 응답 저장 — 토큰 usage 박제 (§8-8 CRITICAL #3 — 토큰 실측 필드 선행)
    const assistantMsg = await this.chatRepo.addMessage(
      sessionId,
      'assistant',
      aiResult.text,
      {
        inputTokens: aiResult.inputTokens,
        outputTokens: aiResult.outputTokens,
        model: aiResult.model,
      },
    )

    // 8. 크레딧 개편 I Phase — 채팅 4구간 사후 차감 (§8-4).
    //    응답은 이미 생성·저장됨 — 차감 실패가 응답을 무효화하지 않음 (사후 차감).
    //    잔액 부족 시 deficit(외상) 누적 + 일시적 DB 오류 유계 재시도는 charge-points.usecase 내부 처리.
    if (this.chargePoints) {
      try {
        const charge = await this.chargePoints.chargeChatTurn(
          authorId,
          aiResult.inputTokens,
          assistantMsg.id,
        )
        // 차감 성공 — 결과(구간/포인트)를 메시지에 사후 박제 (감사 정합).
        // 라벨 박제 실패는 cosmetic (차감은 이미 성공) → warn 만, 응답 무효화 X.
        try {
          await this.chatRepo.updateMessageCharge(
            assistantMsg.id,
            charge.chargedPoints,
            charge.tier,
          )
          assistantMsg.chargedPoints = charge.chargedPoints
          assistantMsg.chargeTier = charge.tier
        } catch (labelErr: unknown) {
          this.logger.warn(
            `채팅 차감 라벨 박제 실패 (assistantMsg=${assistantMsg.id}): ${
              labelErr instanceof Error ? labelErr.message : String(labelErr)
            }`,
          )
        }
      } catch (e: unknown) {
        // F-11 — chargeChatTurn 유계 재시도 소진 후에도 실패 = 차감 유실(§0 revenue leak).
        // 구 주석의 "정합 cron" 은 실재하지 않음(grep 확정) → durable AuditLog 로 재조정 근거를
        // 박제한다(운영자/후속 자동 보정용). 작가 콘텐츠 보호 — 본문은 로깅하지 않고
        // 식별자/토큰수/오류만 박제.
        const msg = e instanceof Error ? e.message : String(e)
        this.logger.error(
          `채팅 사후 차감 실패 (authorId=${authorId}, sessionId=${sessionId}): ${msg}`,
        )
        if (this.auditLog) {
          await this.auditLog
            .log(authorId, 'chat_charge_failed', assistantMsg.id, {
              sessionId,
              inputTokens: aiResult.inputTokens,
              error: msg.slice(0, 300),
            })
            .catch((auditErr: unknown) =>
              this.logger.warn(
                `AuditLog 박제 실패(chat_charge_failed): ${
                  auditErr instanceof Error ? auditErr.message : String(auditErr)
                }`,
              ),
            )
        }
      }
    }

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
