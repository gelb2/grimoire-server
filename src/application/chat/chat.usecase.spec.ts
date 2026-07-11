import { ChatUseCase } from './chat.usecase'
import { NotFoundException, ForbiddenException } from '@nestjs/common'

describe('ChatUseCase', () => {
  let useCase: ChatUseCase
  let mockChatRepo: any
  let mockVectorStore: any
  let mockEmbedding: any
  let mockClaude: any
  let mockWorkRepo: any
  // 크레딧 개편 I Phase — 채팅 4구간 사후 차감 (Optional 주입)
  let mockChargePoints: any

  const mockSession = { id: 'sess-1', authorId: 'author-1', workId: 'work-1', title: '테스트', createdAt: new Date(), updatedAt: new Date() }
  const mockMessage = { id: 'msg-1', sessionId: 'sess-1', role: 'user', content: '질문', createdAt: new Date() }

  beforeEach(() => {
    mockChatRepo = {
      createSession: jest.fn().mockResolvedValue(mockSession),
      findSessionsByAuthorAndWork: jest.fn().mockResolvedValue([mockSession]),
      findSessionById: jest.fn().mockResolvedValue(mockSession),
      addMessage: jest.fn().mockResolvedValue(mockMessage),
      // 크레딧 개편 I Phase — 사후 차감 결과 갱신
      updateMessageCharge: jest.fn().mockResolvedValue(undefined),
      getRecentMessages: jest.fn().mockResolvedValue([]),
      getMessages: jest.fn().mockResolvedValue([mockMessage]),
      deleteSession: jest.fn().mockResolvedValue(undefined),
    }
    mockVectorStore = { searchSimilar: jest.fn().mockResolvedValue([]) }
    mockEmbedding = { getEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]) }
    // 크레딧 개편 I Phase — askWithUsage 가 토큰 usage 를 반환
    mockClaude = {
      ask: jest.fn().mockResolvedValue('AI 응답입니다'),
      askWithUsage: jest.fn().mockResolvedValue({
        text: 'AI 응답입니다',
        inputTokens: 2000,
        outputTokens: 500,
        model: 'claude-sonnet-4-20250514',
      }),
    }
    mockWorkRepo = {
      findById: jest.fn().mockResolvedValue({ id: 'work-1', context: '세계관', instructions: '문체 규칙' }),
      findEpisodes: jest.fn().mockResolvedValue([{ type: 'episode', orderNum: 1, title: '1화' }]),
    }
    // 크레딧 개편 I Phase — 채팅 4구간 사후 차감 mock
    mockChargePoints = {
      isChatBlocked: jest.fn().mockResolvedValue(false),
      chargeChatTurn: jest.fn().mockResolvedValue({
        spentBySource: { free: 0, subscription: 810, gift: 0, charged: 0 },
        deficitIncurred: 0,
        balanceAfter: 92190,
        tier: 'normal',
        chargedPoints: 810,
      }),
    }

    useCase = new ChatUseCase(
      mockChatRepo,
      mockVectorStore,
      mockEmbedding,
      mockClaude,
      mockWorkRepo,
      mockChargePoints,
    )
  })

  describe('createSession', () => {
    it('새 세션을 생성한다', async () => {
      const result = await useCase.createSession('author-1', 'work-1', '테스트')
      expect(result.id).toBe('sess-1')
      expect(mockChatRepo.createSession).toHaveBeenCalledWith('author-1', 'work-1', '테스트')
    })
  })

  describe('listSessions', () => {
    it('작가+작품 기준으로 세션 목록을 반환한다', async () => {
      const result = await useCase.listSessions('author-1', 'work-1')
      expect(result).toHaveLength(1)
    })
  })

  describe('sendMessage', () => {
    it('사용자 메시지 저장 + RAG + AI 응답 생성', async () => {
      mockChatRepo.addMessage
        .mockResolvedValueOnce({ ...mockMessage, role: 'user' })
        .mockResolvedValueOnce({ ...mockMessage, id: 'msg-2', role: 'assistant', content: 'AI 응답' })

      const result = await useCase.sendMessage('author-1', 'sess-1', '캐릭터 분석해줘')

      expect(mockChatRepo.addMessage).toHaveBeenCalledTimes(2)
      expect(mockEmbedding.getEmbedding).toHaveBeenCalledWith('캐릭터 분석해줘')
      // 크레딧 개편 I Phase — askWithUsage 로 토큰 usage 수신
      expect(mockClaude.askWithUsage).toHaveBeenCalled()
      expect(result.userMsg.role).toBe('user')
      expect(result.assistantMsg.role).toBe('assistant')
    })

    it('세션이 없으면 NotFoundException', async () => {
      mockChatRepo.findSessionById.mockResolvedValue(null)
      await expect(useCase.sendMessage('author-1', 'no-sess', 'test')).rejects.toThrow(NotFoundException)
    })

    it('본인 세션이 아니면 ForbiddenException', async () => {
      await expect(useCase.sendMessage('other-author', 'sess-1', 'test')).rejects.toThrow(ForbiddenException)
    })

    // 크레딧 개편 I Phase — 채팅 4구간 사후 차감 연동
    it('AI 응답 후 inputTokens 로 채팅 4구간 사후 차감을 호출한다 (§8-4)', async () => {
      mockChatRepo.addMessage
        .mockResolvedValueOnce({ ...mockMessage, role: 'user' })
        .mockResolvedValueOnce({ ...mockMessage, id: 'msg-2', role: 'assistant' })

      await useCase.sendMessage('author-1', 'sess-1', '질문')

      // askWithUsage 가 반환한 inputTokens(2000) 로 차감
      expect(mockChargePoints.chargeChatTurn).toHaveBeenCalledWith(
        'author-1',
        2000,
        'msg-2',
      )
    })

    it('assistant 메시지 저장 시 토큰 usage 를 박제한다 (§8-8 #3)', async () => {
      mockChatRepo.addMessage
        .mockResolvedValueOnce({ ...mockMessage, role: 'user' })
        .mockResolvedValueOnce({ ...mockMessage, id: 'msg-2', role: 'assistant' })

      await useCase.sendMessage('author-1', 'sess-1', '질문')

      // 2번째 addMessage(assistant) 호출에 tokenMeta 전달
      expect(mockChatRepo.addMessage).toHaveBeenNthCalledWith(
        2,
        'sess-1',
        'assistant',
        'AI 응답입니다',
        {
          inputTokens: 2000,
          outputTokens: 500,
          model: 'claude-sonnet-4-20250514',
        },
      )
    })

    it('사후 차감 결과(구간/포인트)를 메시지에 갱신한다', async () => {
      mockChatRepo.addMessage
        .mockResolvedValueOnce({ ...mockMessage, role: 'user' })
        .mockResolvedValueOnce({ ...mockMessage, id: 'msg-2', role: 'assistant' })

      await useCase.sendMessage('author-1', 'sess-1', '질문')

      expect(mockChatRepo.updateMessageCharge).toHaveBeenCalledWith(
        'msg-2',
        810,
        'normal',
      )
    })

    it('외상 상한 도달 시 신규 채팅을 사전 차단한다 (게이트 5(c))', async () => {
      mockChargePoints.isChatBlocked.mockResolvedValue(true)
      await expect(
        useCase.sendMessage('author-1', 'sess-1', '질문'),
      ).rejects.toThrow(ForbiddenException)
      // 차단되면 AI 호출 자체를 안 함
      expect(mockClaude.askWithUsage).not.toHaveBeenCalled()
    })

    it('사후 차감이 실패해도 응답은 정상 반환한다 (사후 차감 — 응답 무효화 X)', async () => {
      mockChatRepo.addMessage
        .mockResolvedValueOnce({ ...mockMessage, role: 'user' })
        .mockResolvedValueOnce({ ...mockMessage, id: 'msg-2', role: 'assistant' })
      mockChargePoints.chargeChatTurn.mockRejectedValue(new Error('차감 오류'))

      const result = await useCase.sendMessage('author-1', 'sess-1', '질문')
      expect(result.assistantMsg.role).toBe('assistant')
    })

    // F-11 (2026-07-11) — 유계 재시도 소진(chargeChatTurn throw) 시 durable AuditLog 재조정 박제
    it('차감 유실 시 chat_charge_failed AuditLog 를 박제한다 (본문 없이 식별자/토큰수만)', async () => {
      const mockAuditLog = { log: jest.fn().mockResolvedValue(undefined) }
      const ucWithAudit = new ChatUseCase(
        mockChatRepo,
        mockVectorStore,
        mockEmbedding,
        mockClaude,
        mockWorkRepo,
        mockChargePoints,
        mockAuditLog as any,
      )
      mockChatRepo.addMessage
        .mockResolvedValueOnce({ ...mockMessage, role: 'user' })
        .mockResolvedValueOnce({ ...mockMessage, id: 'msg-2', role: 'assistant' })
      mockChargePoints.chargeChatTurn.mockRejectedValue(new Error('DB down'))

      const result = await ucWithAudit.sendMessage('author-1', 'sess-1', '질문')

      // 응답은 정상 반환
      expect(result.assistantMsg.role).toBe('assistant')
      // durable 재조정 근거 박제 (본문 로깅 0 — sessionId/inputTokens 만)
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        'author-1',
        'chat_charge_failed',
        'msg-2',
        expect.objectContaining({ sessionId: 'sess-1', inputTokens: 2000 }),
      )
    })

    // F-11 — 차감 성공 후 라벨 박제 실패는 cosmetic (응답 정상 + chat_charge_failed 미박제)
    it('차감 성공 후 라벨 박제만 실패하면 응답은 정상이고 chat_charge_failed 를 박제하지 않는다', async () => {
      const mockAuditLog = { log: jest.fn().mockResolvedValue(undefined) }
      const ucWithAudit = new ChatUseCase(
        mockChatRepo,
        mockVectorStore,
        mockEmbedding,
        mockClaude,
        mockWorkRepo,
        mockChargePoints,
        mockAuditLog as any,
      )
      mockChatRepo.addMessage
        .mockResolvedValueOnce({ ...mockMessage, role: 'user' })
        .mockResolvedValueOnce({ ...mockMessage, id: 'msg-2', role: 'assistant' })
      // chargeChatTurn 성공(기본 mock) + updateMessageCharge 만 실패
      mockChatRepo.updateMessageCharge.mockRejectedValueOnce(new Error('label db err'))

      const result = await ucWithAudit.sendMessage('author-1', 'sess-1', '질문')

      expect(result.assistantMsg.role).toBe('assistant')
      expect(mockAuditLog.log).not.toHaveBeenCalled()
    })
  })

  describe('getMessages', () => {
    it('히스토리를 반환한다', async () => {
      const result = await useCase.getMessages('author-1', 'sess-1', 30)
      expect(result).toHaveLength(1)
    })

    it('본인 세션이 아니면 ForbiddenException', async () => {
      await expect(useCase.getMessages('other', 'sess-1', 30)).rejects.toThrow(ForbiddenException)
    })
  })

  describe('deleteSession', () => {
    it('세션을 삭제한다', async () => {
      await useCase.deleteSession('author-1', 'sess-1')
      expect(mockChatRepo.deleteSession).toHaveBeenCalledWith('sess-1')
    })

    it('본인 세션이 아니면 ForbiddenException', async () => {
      await expect(useCase.deleteSession('other', 'sess-1')).rejects.toThrow(ForbiddenException)
    })
  })
})
