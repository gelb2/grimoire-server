import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { ManuscriptController } from './manuscript.controller'
import { ParseManuscriptUseCase } from '@application/manuscript/parse-manuscript.usecase'
import { JwtAuthGuard } from '@adapter/inbound/http/guard/jwt-auth.guard'

describe('ManuscriptController — upload', () => {
  let controller: ManuscriptController
  let useCase: ParseManuscriptUseCase

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ManuscriptController],
      providers: [
        {
          provide: ParseManuscriptUseCase,
          useValue: {
            execute: jest.fn().mockReturnValue({
              frontmatter: { slug: 'test', type: 'episode' },
              title: 'test',
              blocks: [{ type: 'paragraph', text: '테스트' }],
            }),
            executeFromBuffer: jest.fn().mockResolvedValue({
              frontmatter: { slug: 'test', type: 'episode' },
              title: 'test',
              blocks: [{ type: 'paragraph', text: '테스트' }],
            }),
          },
        },
      ],
    })
      // JwtAuthGuard 모킹 — 인증 우회
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get<ManuscriptController>(ManuscriptController)
    useCase = module.get<ParseManuscriptUseCase>(ParseManuscriptUseCase)
  })

  /** 테스트용 Multer.File 객체 생성 헬퍼 */
  function createMockFile(
    originalname: string,
    content: string | Buffer = '테스트 내용',
  ): Express.Multer.File {
    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content
    return {
      fieldname: 'file',
      originalname,
      encoding: '7bit',
      mimetype: 'application/octet-stream',
      buffer,
      size: buffer.length,
      stream: null as any,
      destination: '',
      filename: '',
      path: '',
    }
  }

  it('.md 파일 업로드 시 executeFromBuffer를 호출한다', async () => {
    const file = createMockFile('chapter1.md', '# 제목\n\n본문입니다.')
    await controller.uploadManuscript(file)

    expect(useCase.executeFromBuffer).toHaveBeenCalledWith({
      buffer: file.buffer,
      format: 'md',
      filename: 'chapter1.md',
    })
  })

  it('.txt 파일 업로드 시 txt 포맷으로 전달한다', async () => {
    const file = createMockFile('novel.txt', '첫 번째 문단\n\n두 번째 문단')
    await controller.uploadManuscript(file)

    expect(useCase.executeFromBuffer).toHaveBeenCalledWith({
      buffer: file.buffer,
      format: 'txt',
      filename: 'novel.txt',
    })
  })

  it('.docx 파일 업로드 시 docx 포맷으로 전달한다', async () => {
    const file = createMockFile('novel.docx', Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    await controller.uploadManuscript(file)

    expect(useCase.executeFromBuffer).toHaveBeenCalledWith({
      buffer: file.buffer,
      format: 'docx',
      filename: 'novel.docx',
    })
  })

  it('.hwp 파일 업로드 시 hwp 포맷으로 전달한다', async () => {
    const file = createMockFile('novel.hwp', Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))
    await controller.uploadManuscript(file)

    expect(useCase.executeFromBuffer).toHaveBeenCalledWith({
      buffer: file.buffer,
      format: 'hwp',
      filename: 'novel.hwp',
    })
  })

  it('.hwpx 파일 업로드 시 hwpx 포맷으로 전달한다', async () => {
    const file = createMockFile('novel.hwpx', Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    await controller.uploadManuscript(file)

    expect(useCase.executeFromBuffer).toHaveBeenCalledWith({
      buffer: file.buffer,
      format: 'hwpx',
      filename: 'novel.hwpx',
    })
  })

  it('파일이 없으면 BadRequestException을 던진다', async () => {
    await expect(
      controller.uploadManuscript(undefined as any),
    ).rejects.toThrow(BadRequestException)
  })
})
