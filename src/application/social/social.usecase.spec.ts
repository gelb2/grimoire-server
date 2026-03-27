import { BadRequestException } from '@nestjs/common'
import { SocialUseCase } from './social.usecase'

describe('SocialUseCase', () => {
  let useCase: SocialUseCase
  let mockSocialRepo: {
    toggleLike: jest.Mock
    getLikeCount: jest.Mock
    isLiked: jest.Mock
    toggleSubscription: jest.Mock
    getSubscriptions: jest.Mock
    getSubscriberCount: jest.Mock
    isSubscribed: jest.Mock
    createComment: jest.Mock
    getComments: jest.Mock
    deleteComment: jest.Mock
    getCommentCount: jest.Mock
    getTotalLikesForAuthor: jest.Mock
  }

  const mockComment = {
    id: 'comment-1',
    authorId: 'author-1',
    episodeId: 'ep-1',
    content: '좋은 소설이네요',
    createdAt: new Date(),
  }

  const mockSubscription = {
    id: 'sub-1',
    subscriberId: 'author-1',
    targetAuthorId: 'author-2',
    createdAt: new Date(),
  }

  beforeEach(() => {
    mockSocialRepo = {
      toggleLike: jest.fn().mockResolvedValue({ liked: true, likeCount: 1 }),
      getLikeCount: jest.fn().mockResolvedValue(5),
      isLiked: jest.fn().mockResolvedValue(false),
      toggleSubscription: jest.fn().mockResolvedValue({ subscribed: true }),
      getSubscriptions: jest.fn().mockResolvedValue([mockSubscription]),
      getSubscriberCount: jest.fn().mockResolvedValue(10),
      isSubscribed: jest.fn().mockResolvedValue(false),
      createComment: jest.fn().mockResolvedValue(mockComment),
      getComments: jest.fn().mockResolvedValue([mockComment]),
      deleteComment: jest.fn().mockResolvedValue(undefined),
      getCommentCount: jest.fn().mockResolvedValue(3),
      getTotalLikesForAuthor: jest.fn().mockResolvedValue(15),
    }

    const mockCreditRepo = { adjustCredits: jest.fn(), findLogsByAuthorId: jest.fn(), giftTransfer: jest.fn(), getGiftRanking: jest.fn() }
    const mockAuthorRepo = { findById: jest.fn(), findBySlug: jest.fn(), findByEmail: jest.fn(), create: jest.fn(), updateCredits: jest.fn() }
    useCase = new SocialUseCase(mockSocialRepo as any, mockCreditRepo as any, mockAuthorRepo as any)
  })

  // ── 좋아요 ──

  describe('toggleLike', () => {
    it('좋아요를 토글하고 liked 상태와 좋아요 수를 반환한다', async () => {
      const result = await useCase.toggleLike('author-1', 'ep-1')

      expect(mockSocialRepo.toggleLike).toHaveBeenCalledWith('author-1', 'ep-1')
      expect(result.liked).toBe(true)
      expect(result.likeCount).toBe(1)
    })

    it('좋아요 취소 시 liked: false를 반환한다', async () => {
      mockSocialRepo.toggleLike.mockResolvedValue({ liked: false, likeCount: 0 })

      const result = await useCase.toggleLike('author-1', 'ep-1')

      expect(result.liked).toBe(false)
      expect(result.likeCount).toBe(0)
    })
  })

  describe('getLikeCount', () => {
    it('에피소드의 좋아요 수를 반환한다', async () => {
      const result = await useCase.getLikeCount('ep-1')

      expect(mockSocialRepo.getLikeCount).toHaveBeenCalledWith('ep-1')
      expect(result).toBe(5)
    })
  })

  // ── 구독 ──

  describe('toggleSubscription', () => {
    it('구독을 토글하고 subscribed 상태를 반환한다', async () => {
      const result = await useCase.toggleSubscription('author-1', 'author-2')

      expect(mockSocialRepo.toggleSubscription).toHaveBeenCalledWith('author-1', 'author-2')
      expect(result.subscribed).toBe(true)
    })

    it('구독 해제 시 subscribed: false를 반환한다', async () => {
      mockSocialRepo.toggleSubscription.mockResolvedValue({ subscribed: false })

      const result = await useCase.toggleSubscription('author-1', 'author-2')

      expect(result.subscribed).toBe(false)
    })
  })

  describe('getSubscriptions', () => {
    it('구독 목록을 반환한다', async () => {
      const result = await useCase.getSubscriptions('author-1')

      expect(mockSocialRepo.getSubscriptions).toHaveBeenCalledWith('author-1')
      expect(result).toHaveLength(1)
      expect(result[0].targetAuthorId).toBe('author-2')
    })
  })

  describe('getSubscriberCount', () => {
    it('구독자 수를 반환한다', async () => {
      const result = await useCase.getSubscriberCount('author-2')

      expect(mockSocialRepo.getSubscriberCount).toHaveBeenCalledWith('author-2')
      expect(result).toBe(10)
    })
  })

  // ── 댓글 ──

  describe('createComment', () => {
    it('댓글을 생성하고 반환한다', async () => {
      const result = await useCase.createComment('author-1', 'ep-1', '좋은 소설이네요')

      expect(mockSocialRepo.createComment).toHaveBeenCalledWith('author-1', 'ep-1', '좋은 소설이네요', undefined)
      expect(result.content).toBe('좋은 소설이네요')
    })

    it('빈 내용이면 BadRequestException을 던진다', async () => {
      await expect(useCase.createComment('author-1', 'ep-1', '')).rejects.toThrow(BadRequestException)
    })

    it('공백만 있는 내용이면 BadRequestException을 던진다', async () => {
      await expect(useCase.createComment('author-1', 'ep-1', '   ')).rejects.toThrow(BadRequestException)
    })

    it('500자 초과 시 BadRequestException을 던진다', async () => {
      const longContent = 'a'.repeat(501)
      await expect(useCase.createComment('author-1', 'ep-1', longContent)).rejects.toThrow(BadRequestException)
    })

    it('500자 이하는 정상 처리된다', async () => {
      const content = 'a'.repeat(500)
      await useCase.createComment('author-1', 'ep-1', content)

      expect(mockSocialRepo.createComment).toHaveBeenCalledWith('author-1', 'ep-1', content, undefined)
    })

    it('내용의 앞뒤 공백을 제거한다', async () => {
      await useCase.createComment('author-1', 'ep-1', '  좋은 소설  ')

      expect(mockSocialRepo.createComment).toHaveBeenCalledWith('author-1', 'ep-1', '좋은 소설', undefined)
    })

    it('parentId를 전달하여 대댓글을 생성한다', async () => {
      const replyComment = { ...mockComment, id: 'comment-2', parentId: 'comment-1' }
      mockSocialRepo.createComment.mockResolvedValue(replyComment)

      const result = await useCase.createComment('author-1', 'ep-1', '답글입니다', 'comment-1')

      expect(mockSocialRepo.createComment).toHaveBeenCalledWith('author-1', 'ep-1', '답글입니다', 'comment-1')
      expect(result.parentId).toBe('comment-1')
    })
  })

  describe('getComments', () => {
    it('에피소드의 댓글 목록을 반환한다', async () => {
      const result = await useCase.getComments('ep-1')

      expect(mockSocialRepo.getComments).toHaveBeenCalledWith('ep-1')
      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('좋은 소설이네요')
    })
  })

  describe('deleteComment', () => {
    it('댓글 삭제를 레포에 위임한다', async () => {
      await useCase.deleteComment('comment-1', 'author-1')

      expect(mockSocialRepo.deleteComment).toHaveBeenCalledWith('comment-1', 'author-1')
    })
  })
})
