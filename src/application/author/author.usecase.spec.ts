import { AuthorUseCase } from './author.usecase'
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common'

describe('AuthorUseCase', () => {
  let useCase: AuthorUseCase
  let mockAuthorRepo: { findBySlug: jest.Mock; updateBio: jest.Mock }
  let mockThemeRepo: { findAllByAuthorId: jest.Mock }
  let mockWorkRepo: { findByAuthorSlug: jest.Mock; findEpisodes: jest.Mock }
  let mockSocialRepo: { getSubscriberCount: jest.Mock; getTotalLikesForAuthor: jest.Mock }

  const mockAuthor = {
    id: 'author-1', slug: 'test-author', name: '테스트 작가',
    email: 'test@test.com', passwordHash: 'hashed', role: 'author',
    bio: '안녕하세요', credits: 3, createdAt: new Date(),
  }
  const mockTheme = { id: 'theme-1', authorId: 'author-1', name: '다크 테마' }
  const mockWork = { id: 'work-1', slug: 'my-novel', title: '테스트 소설', subtitle: null, description: '설명', viewCount: 100 }
  const mockEpisodes = [
    { id: 'ep-1', slug: 'ch-1', title: '1화' },
    { id: 'ep-2', slug: 'ch-2', title: '2화' },
  ]

  beforeEach(() => {
    mockAuthorRepo = {
      findBySlug: jest.fn().mockResolvedValue(mockAuthor),
      updateBio: jest.fn().mockResolvedValue({ ...mockAuthor, bio: '새로운 소개' }),
    }
    mockThemeRepo = {
      findAllByAuthorId: jest.fn().mockResolvedValue([mockTheme]),
    }
    mockWorkRepo = {
      findByAuthorSlug: jest.fn().mockResolvedValue([mockWork]),
      findEpisodes: jest.fn().mockResolvedValue(mockEpisodes),
    }
    mockSocialRepo = {
      getSubscriberCount: jest.fn().mockResolvedValue(42),
      getTotalLikesForAuthor: jest.fn().mockResolvedValue(150),
    }

    useCase = new AuthorUseCase(
      mockAuthorRepo as any,
      mockThemeRepo as any,
      mockWorkRepo as any,
      mockSocialRepo as any,
    )
  })

  describe('getAuthorSpace', () => {
    it('작가 공간 데이터 (작가 + 테마 + 작품 목록)를 반환한다', async () => {
      const result = await useCase.getAuthorSpace('test-author')

      expect(mockAuthorRepo.findBySlug).toHaveBeenCalledWith('test-author')
      expect(mockThemeRepo.findAllByAuthorId).toHaveBeenCalledWith('author-1')
      expect(mockWorkRepo.findByAuthorSlug).toHaveBeenCalledWith('test-author')
      expect(result.author).toBeDefined()
      // toSafeAuthor로 민감 정보 제거 확인
      expect(result.author).not.toHaveProperty('passwordHash')
      expect(result.author).not.toHaveProperty('email')
      expect(result.theme).toEqual(mockTheme)
      expect(result.works).toHaveLength(1)
      expect(result.works[0].episodeCount).toBe(2)
    })

    it('작가가 없으면 NotFoundException을 던진다', async () => {
      mockAuthorRepo.findBySlug.mockResolvedValue(null)

      await expect(useCase.getAuthorSpace('no-author')).rejects.toThrow(NotFoundException)
      await expect(useCase.getAuthorSpace('no-author')).rejects.toThrow('작가를 찾을 수 없습니다')
    })
  })

  describe('getPublicProfile', () => {
    it('작가 공개 프로필 (작품 + 구독자 수 + 좋아요)을 반환한다', async () => {
      const result = await useCase.getPublicProfile('test-author')

      expect(result.author).toBeDefined()
      expect(result.author).not.toHaveProperty('passwordHash')
      expect(result.works).toHaveLength(1)
      expect(result.works[0].episodeCount).toBe(2)
      expect(result.works[0].viewCount).toBe(100)
      expect(result.subscriberCount).toBe(42)
      expect(result.totalLikes).toBe(150)
      expect(mockSocialRepo.getSubscriberCount).toHaveBeenCalledWith('author-1')
      expect(mockSocialRepo.getTotalLikesForAuthor).toHaveBeenCalledWith('author-1')
    })

    it('작가가 없으면 NotFoundException을 던진다', async () => {
      mockAuthorRepo.findBySlug.mockResolvedValue(null)

      await expect(useCase.getPublicProfile('no-author')).rejects.toThrow(NotFoundException)
    })
  })

  describe('updateBio', () => {
    it('본인 프로필의 소개글을 업데이트한다', async () => {
      const result = await useCase.updateBio('test-author', 'author-1', '새로운 소개')

      expect(mockAuthorRepo.updateBio).toHaveBeenCalledWith('author-1', '새로운 소개')
      expect(result.bio).toBe('새로운 소개')
    })

    it('작가가 없으면 NotFoundException을 던진다', async () => {
      mockAuthorRepo.findBySlug.mockResolvedValue(null)

      await expect(useCase.updateBio('no-author', 'author-1', '소개')).rejects.toThrow(NotFoundException)
    })

    it('본인이 아니면 ForbiddenException을 던진다', async () => {
      await expect(useCase.updateBio('test-author', 'other-author', '소개')).rejects.toThrow(ForbiddenException)
      await expect(useCase.updateBio('test-author', 'other-author', '소개')).rejects.toThrow('본인의 프로필만 수정할 수 있습니다')
    })

    it('소개글이 500자를 초과하면 BadRequestException을 던진다', async () => {
      const longBio = 'A'.repeat(501)

      await expect(useCase.updateBio('test-author', 'author-1', longBio)).rejects.toThrow(BadRequestException)
      await expect(useCase.updateBio('test-author', 'author-1', longBio)).rejects.toThrow('500자 이내')
    })
  })
})
