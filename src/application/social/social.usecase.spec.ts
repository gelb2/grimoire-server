import { BadRequestException } from '@nestjs/common'
import { SocialUseCase } from './social.usecase'

describe('SocialUseCase', () => {
  let useCase: SocialUseCase
  let mockSocialRepo: {
    toggleLike: jest.Mock
    getLikeCount: jest.Mock
    isLiked: jest.Mock
    createAnonymousLike: jest.Mock
    isAnonymousLiked: jest.Mock
    toggleSubscription: jest.Mock
    getSubscriptions: jest.Mock
    getSubscriberCount: jest.Mock
    isSubscribed: jest.Mock
    createComment: jest.Mock
    getComments: jest.Mock
    deleteComment: jest.Mock
    getCommentCount: jest.Mock
    createAnonymousComment: jest.Mock
    deleteAnonymousComment: jest.Mock
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
      createAnonymousLike: jest.fn().mockResolvedValue({ likeCount: 6 }),
      isAnonymousLiked: jest.fn().mockResolvedValue(false),
      toggleSubscription: jest.fn().mockResolvedValue({ subscribed: true }),
      getSubscriptions: jest.fn().mockResolvedValue([mockSubscription]),
      getSubscriberCount: jest.fn().mockResolvedValue(10),
      isSubscribed: jest.fn().mockResolvedValue(false),
      createComment: jest.fn().mockResolvedValue(mockComment),
      getComments: jest.fn().mockResolvedValue([mockComment]),
      deleteComment: jest.fn().mockResolvedValue(undefined),
      getCommentCount: jest.fn().mockResolvedValue(3),
      createAnonymousComment: jest.fn().mockResolvedValue({ ...mockComment, authorId: null, nickname: '익명' }),
      deleteAnonymousComment: jest.fn().mockResolvedValue(undefined),
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

  // ── 익명 좋아요 ──

  describe('anonymousLike', () => {
    it('익명 좋아요를 생성하고 liked: true를 반환한다', async () => {
      const result = await useCase.anonymousLike('ep-1', '127.0.0.1', 'cookie-abc')

      expect(mockSocialRepo.createAnonymousLike).toHaveBeenCalledWith({
        episodeId: 'ep-1',
        ipAddress: '127.0.0.1',
        cookieId: 'cookie-abc',
      })
      expect(result.liked).toBe(true)
      expect(result.likeCount).toBe(6)
    })
  })

  describe('getLikeStatus', () => {
    it('로그인 사용자의 좋아요 상태를 조회한다', async () => {
      mockSocialRepo.isLiked.mockResolvedValue(true)

      const result = await useCase.getLikeStatus('ep-1', 'author-1')

      expect(mockSocialRepo.isLiked).toHaveBeenCalledWith('author-1', 'ep-1')
      expect(result.liked).toBe(true)
      expect(result.likeCount).toBe(5)
    })

    it('비로그인 사용자의 좋아요 상태를 IP+쿠키로 조회한다', async () => {
      mockSocialRepo.isAnonymousLiked.mockResolvedValue(true)

      const result = await useCase.getLikeStatus('ep-1', undefined, '127.0.0.1', 'cookie-abc')

      expect(mockSocialRepo.isAnonymousLiked).toHaveBeenCalledWith('127.0.0.1', 'cookie-abc', 'ep-1')
      expect(result.liked).toBe(true)
    })

    it('인증 정보 없으면 liked: false를 반환한다', async () => {
      const result = await useCase.getLikeStatus('ep-1')

      expect(result.liked).toBe(false)
      expect(result.likeCount).toBe(5)
    })
  })

  // ── 익명 댓글 ──

  describe('createAnonymousComment', () => {
    it('닉네임+비밀번호로 익명 댓글을 생성한다', async () => {
      const result = await useCase.createAnonymousComment({
        episodeId: 'ep-1',
        content: '익명 댓글입니다',
        nickname: '익명이',
        password: '1234',
        ipAddress: '127.0.0.1',
      })

      expect(mockSocialRepo.createAnonymousComment).toHaveBeenCalled()
      expect(result.authorId).toBeNull()
      expect(result.nickname).toBe('익명')
    })

    it('닉네임이 2자 미만이면 BadRequestException', async () => {
      await expect(useCase.createAnonymousComment({
        episodeId: 'ep-1',
        content: '댓글',
        nickname: 'a',
        password: '1234',
        ipAddress: '127.0.0.1',
      })).rejects.toThrow(BadRequestException)
    })

    it('닉네임이 20자 초과이면 BadRequestException', async () => {
      await expect(useCase.createAnonymousComment({
        episodeId: 'ep-1',
        content: '댓글',
        nickname: 'a'.repeat(21),
        password: '1234',
        ipAddress: '127.0.0.1',
      })).rejects.toThrow(BadRequestException)
    })

    it('비밀번호가 4자 미만이면 BadRequestException', async () => {
      await expect(useCase.createAnonymousComment({
        episodeId: 'ep-1',
        content: '댓글',
        nickname: '익명이',
        password: '123',
        ipAddress: '127.0.0.1',
      })).rejects.toThrow(BadRequestException)
    })

    it('비밀번호가 20자 초과이면 BadRequestException', async () => {
      await expect(useCase.createAnonymousComment({
        episodeId: 'ep-1',
        content: '댓글',
        nickname: '익명이',
        password: 'a'.repeat(21),
        ipAddress: '127.0.0.1',
      })).rejects.toThrow(BadRequestException)
    })

    it('빈 내용이면 BadRequestException', async () => {
      await expect(useCase.createAnonymousComment({
        episodeId: 'ep-1',
        content: '',
        nickname: '익명이',
        password: '1234',
        ipAddress: '127.0.0.1',
      })).rejects.toThrow(BadRequestException)
    })

    it('HTML 태그를 이스케이프한다', async () => {
      await useCase.createAnonymousComment({
        episodeId: 'ep-1',
        content: '<script>alert("xss")</script>',
        nickname: '<b>해커</b>',
        password: '1234',
        ipAddress: '127.0.0.1',
      })

      const call = mockSocialRepo.createAnonymousComment.mock.calls[0][0]
      expect(call.content).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
      expect(call.nickname).toBe('&lt;b&gt;해커&lt;/b&gt;')
    })
  })

  describe('deleteAnonymousComment', () => {
    it('비밀번호로 익명 댓글 삭제를 레포에 위임한다', async () => {
      await useCase.deleteAnonymousComment('comment-1', '1234')

      expect(mockSocialRepo.deleteAnonymousComment).toHaveBeenCalledWith('comment-1', '1234')
    })
  })

  // ── CC-2b: giftCredits 신 경로 (ledger.transfer + pt 단위 단계) ──
  describe('giftCredits (CC-2b — ledger.transfer + GIFT_POINT_OPTIONS)', () => {
    /** 신 경로 setup — ledger.transfer mock + authorRepo.findBySlug mock */
    function setupCC2b() {
      const mockLedger = {
        getBalance: jest.fn(),
        earn: jest.fn(),
        spend: jest.fn(),
        settleDeficit: jest.fn(),
        findByAuthor: jest.fn(),
        transfer: jest.fn().mockResolvedValue({
          senderSpentBySource: { free: 0, subscription: 0, gift: 0, charged: 1000 },
          receiverGiftBalance: 1000,
        }),
      }
      const mockAuthorRepo2 = {
        findById: jest.fn(),
        findBySlug: jest.fn().mockResolvedValue({
          id: 'author-r',
          slug: 'receiver',
          name: 'R',
          email: 'r@r.com',
          credits: 0,
          createdAt: new Date(),
        }),
        findByEmail: jest.fn(),
        create: jest.fn(),
        updateCredits: jest.fn(),
      }
      const mockCreditRepo2 = { adjustCredits: jest.fn(), findLogsByAuthorId: jest.fn(), giftTransfer: jest.fn(), getGiftRanking: jest.fn() }
      const uc = new SocialUseCase(
        mockSocialRepo as any,
        mockCreditRepo2 as any,
        mockAuthorRepo2 as any,
        mockLedger as any,
      )
      return { uc, mockLedger, mockAuthorRepo2, mockCreditRepo2 }
    }

    it('GIFT_POINT_OPTIONS [1000,3000,5000] 중 1000pt 선물 시 ledger.transfer 호출 + 구 giftTransfer 0건', async () => {
      const { uc, mockLedger, mockCreditRepo2 } = setupCC2b()

      const result = await uc.giftCredits('reader-1', 'receiver', 1000)

      expect(mockLedger.transfer).toHaveBeenCalledWith('reader-1', 'author-r', 1000, undefined)
      expect(mockCreditRepo2.giftTransfer).not.toHaveBeenCalled()
      expect(result.receiverGiftBalance).toBe(1000)
    })

    it('GIFT_POINT_OPTIONS 외 값(예: 1·3·5 구 크레딧) 거부', async () => {
      const { uc, mockLedger } = setupCC2b()

      await expect(uc.giftCredits('reader-1', 'receiver', 1)).rejects.toThrow(/1000, 3000, 5000pt/)
      await expect(uc.giftCredits('reader-1', 'receiver', 3)).rejects.toThrow()
      await expect(uc.giftCredits('reader-1', 'receiver', 5)).rejects.toThrow()
      expect(mockLedger.transfer).not.toHaveBeenCalled()
    })

    it('자기 자신 선물 거부', async () => {
      const { uc, mockAuthorRepo2, mockLedger } = setupCC2b()
      mockAuthorRepo2.findBySlug.mockResolvedValueOnce({
        id: 'reader-1', slug: 'receiver', name: 'R', email: 'r@r.com', credits: 0, createdAt: new Date(),
      })

      await expect(uc.giftCredits('reader-1', 'receiver', 1000)).rejects.toThrow(/자기/)
      expect(mockLedger.transfer).not.toHaveBeenCalled()
    })

    it('받는 작가 미존재 NotFound', async () => {
      const { uc, mockAuthorRepo2, mockLedger } = setupCC2b()
      mockAuthorRepo2.findBySlug.mockResolvedValueOnce(null)

      await expect(uc.giftCredits('reader-1', 'ghost', 3000)).rejects.toThrow(/작가/)
      expect(mockLedger.transfer).not.toHaveBeenCalled()
    })

    it('ledger transfer 잔액 부족 throw → BadRequest', async () => {
      const { uc, mockLedger } = setupCC2b()
      mockLedger.transfer.mockRejectedValueOnce(new Error('포인트가 부족합니다'))

      await expect(uc.giftCredits('reader-1', 'receiver', 5000)).rejects.toThrow(/포인트가 부족/)
    })

    it('ledger 미주입 시 BadRequest (CC-2b 신 경로 필수)', async () => {
      // mockLedger 미주입 — 신 경로 필수
      await expect(useCase.giftCredits('reader-1', 'receiver', 1000)).rejects.toThrow()
    })
  })
})
