import { ChatUseCase } from './chat.usecase'
import { NotFoundException, ForbiddenException } from '@nestjs/common'

describe('ChatUseCase', () => {
  let useCase: ChatUseCase
  let mockChatRepo: any
  let mockVectorStore: any
  let mockEmbedding: any
  let mockClaude: any
  let mockWorkRepo: any

  const mockSession = { id: 'sess-1', authorId: 'author-1', workId: 'work-1', title: '테스트', createdAt: new Date(), updatedAt: new Date() }
  const mockMessage = { id: 'msg-1', sessionId: 'sess-1', role: 'user', content: '질문', createdAt: new Date() }

  beforeEach(() => {
    mockChatRepo = {
      createSession: jest.fn().mockResolvedValue(mockSession),
      findSessionsByAuthorAndWork: jest.fn().mockResolvedValue([mockSession]),
      findSessionById: jest.fn().mockResolvedValue(mockSession),
      addMessage: jest.fn().mockResolvedValue(mockMessage),
      getRecentMessages: jest.fn().mockResolvedValue([]),
      getMessages: jest.fn().mockResolvedValue([mockMessage]),
      deleteSession: jest.fn().mockResolvedValue(undefined),
    }
    mockVectorStore = { searchSimilar: jest.fn().mockResolvedValue([]) }
    mockEmbedding = { getEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]) }
    mockClaude = { ask: jest.fn().mockResolvedValue('AI 응답입니다') }
    mockWorkRepo = {
      findById: jest.fn().mockResolvedValue({ id: 'work-1', context: '세계관', instructions: '문체 규칙' }),
      findEpisodes: jest.fn().mockResolvedValue([{ type: 'episode', orderNum: 1, title: '1화' }]),
    }

    useCase = new ChatUseCase(mockChatRepo, mockVectorStore, mockEmbedding, mockClaude, mockWorkRepo)
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
      expect(mockClaude.ask).toHaveBeenCalled()
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
