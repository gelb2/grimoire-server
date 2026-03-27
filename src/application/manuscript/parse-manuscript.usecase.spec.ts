import { BadRequestException } from '@nestjs/common'
import { ParseManuscriptUseCase } from './parse-manuscript.usecase'

// 파서 모킹
jest.mock('@lib/txt-parser', () => ({
  parseTxt: jest.fn().mockReturnValue({
    frontmatter: { slug: 'test', type: 'episode' },
    blocks: [{ type: 'paragraph', text: '테스트' }],
  }),
}))

jest.mock('@lib/docx-parser', () => ({
  parseDocx: jest.fn().mockResolvedValue({
    frontmatter: { slug: 'test', type: 'episode' },
    blocks: [{ type: 'paragraph', text: '테스트' }],
  }),
}))

jest.mock('@lib/hwp-parser', () => ({
  parseHwp: jest.fn().mockResolvedValue({
    frontmatter: { slug: 'test', type: 'episode' },
    blocks: [{ type: 'paragraph', text: '테스트' }],
  }),
  parseHwpx: jest.fn().mockResolvedValue({
    frontmatter: { slug: 'test', type: 'episode' },
    blocks: [{ type: 'paragraph', text: '테스트' }],
  }),
}))

// md-parser는 실제 모듈 사용 (execute 메서드 테스트에 필요)
jest.mock('@lib/md-parser', () => ({
  parseFrontmatter: jest.fn().mockReturnValue({
    frontmatter: { slug: 'ep01', type: 'episode' },
    body: '본문입니다.',
  }),
  parseEpisodeBlocks: jest.fn().mockReturnValue({
    title: '에피소드 1',
    blocks: [{ type: 'paragraph', text: '본문입니다.' }],
  }),
  parsePreface: jest.fn(),
  parseAfterword: jest.fn(),
}))

describe('ParseManuscriptUseCase', () => {
  let useCase: ParseManuscriptUseCase

  beforeEach(() => {
    useCase = new ParseManuscriptUseCase()
    jest.clearAllMocks()
  })

  describe('execute (기존 MD 파싱)', () => {
    it('MD 텍스트를 파싱하여 결과를 반환한다', () => {
      const result = useCase.execute('---\nslug: ep01\ntype: episode\n---\n본문입니다.')
      expect(result.frontmatter.slug).toBe('ep01')
      expect(result.blocks).toBeDefined()
    })

    it('빈 텍스트는 BadRequestException을 던진다', () => {
      expect(() => useCase.execute('')).toThrow(BadRequestException)
      expect(() => useCase.execute('   ')).toThrow(BadRequestException)
    })
  })

  describe('executeFromBuffer', () => {
    it('txt 포맷을 parseTxt로 라우팅한다', async () => {
      const { parseTxt } = require('@lib/txt-parser')
      const buffer = Buffer.from('텍스트 내용')

      await useCase.executeFromBuffer({
        buffer,
        format: 'txt',
        filename: 'novel.txt',
      })

      expect(parseTxt).toHaveBeenCalledWith(
        '텍스트 내용',
        { title: 'novel' },
      )
    })

    it('docx 포맷을 parseDocx로 라우팅한다', async () => {
      const { parseDocx } = require('@lib/docx-parser')
      const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04])

      await useCase.executeFromBuffer({
        buffer,
        format: 'docx',
        filename: 'my-novel.docx',
      })

      expect(parseDocx).toHaveBeenCalledWith(buffer, { title: 'my-novel' })
    })

    it('hwp 포맷을 parseHwp로 라우팅한다', async () => {
      const { parseHwp } = require('@lib/hwp-parser')
      const buffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0])

      await useCase.executeFromBuffer({
        buffer,
        format: 'hwp',
        filename: '소설.hwp',
      })

      expect(parseHwp).toHaveBeenCalledWith(buffer, { title: '소설' })
    })

    it('hwpx 포맷을 parseHwpx로 라우팅한다', async () => {
      const { parseHwpx } = require('@lib/hwp-parser')
      const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04])

      await useCase.executeFromBuffer({
        buffer,
        format: 'hwpx',
        filename: '소설.hwpx',
      })

      expect(parseHwpx).toHaveBeenCalledWith(buffer, { title: '소설' })
    })

    it('md 포맷은 UTF-8 변환 후 execute를 호출한다', async () => {
      const mdContent = '---\nslug: ep01\ntype: episode\n---\n본문'
      const buffer = Buffer.from(mdContent, 'utf-8')

      const result = await useCase.executeFromBuffer({
        buffer,
        format: 'md',
        filename: 'chapter1.md',
      })

      expect(result.frontmatter).toBeDefined()
    })

    it('빈 Buffer는 BadRequestException을 던진다', async () => {
      await expect(
        useCase.executeFromBuffer({
          buffer: Buffer.alloc(0),
          format: 'md',
          filename: 'empty.md',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('지원하지 않는 포맷은 BadRequestException을 던진다', async () => {
      await expect(
        useCase.executeFromBuffer({
          buffer: Buffer.from('data'),
          format: 'pdf' as any,
          filename: 'doc.pdf',
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })
})
