import Anthropic from '@anthropic-ai/sdk'
import { askClaude } from './claude'

const mockCreate = jest.fn().mockResolvedValue({
  content: [{ type: 'text', text: 'fixture' }],
  usage: { input_tokens: 1, output_tokens: 1 }, model: 'fixture',
})
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } })),
}))

describe('Claude 설정 경계', () => {
  const originalEnv = { ...process.env }
  afterEach(() => { process.env = { ...originalEnv }; jest.clearAllMocks() })

  it('API 키가 없으면 SDK와 외부 호출을 시작하지 않는다', async () => {
    delete process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_AUTH_TOKEN = 'unrelated-shell-token'
    await expect(askClaude('fixture', 'fixture')).rejects.toThrow('AI 기능이 설정되지')
    expect(Anthropic).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('기존 클라이언트가 있어도 키 제거 뒤에는 호출을 차단한다', async () => {
    process.env.ANTHROPIC_API_KEY = 'local-test-fixture'
    await expect(askClaude('fixture', 'fixture')).resolves.toBe('fixture')
    delete process.env.ANTHROPIC_API_KEY
    await expect(askClaude('fixture', 'fixture')).rejects.toThrow('AI 기능이 설정되지')
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })
})
