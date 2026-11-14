import { requireLocalSeedTarget } from './local-seed-target'

describe('로컬 시드 대상', () => {
  const originalEnv = { ...process.env }
  beforeEach(() => { process.env.APP_ENV = 'localhost' })
  afterEach(() => { process.env = { ...originalEnv } })

  it.each(['localhost', '127.0.0.1', '[::1]'])('루프백 %s를 허용한다', (host) => {
    process.env.DATABASE_URL = `postgresql://local:local@${host}:55432/demo`
    expect(requireLocalSeedTarget('DATABASE_URL', ['postgresql:'])).toBe(process.env.DATABASE_URL)
  })

  it.each([
    undefined, '', 'postgresql://remote.example.test/demo',
    'postgresql://localhost.evil.test/demo', 'https://localhost/demo',
    'postgresql://localhost/demo?host=remote.example.test',
  ])('미설정·원격·호스트 우회 URL을 차단한다', (value) => {
    if (value === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = value
    expect(() => requireLocalSeedTarget('DATABASE_URL', ['postgresql:'])).toThrow('DATABASE_URL')
  })

  it('로컬 URL이어도 원격 APP_ENV를 차단한다', () => {
    process.env.APP_ENV = 'production'
    process.env.DATABASE_URL = 'postgresql://localhost/demo'
    expect(() => requireLocalSeedTarget('DATABASE_URL', ['postgresql:'])).toThrow('APP_ENV=localhost')
  })

  it('API URL에 자격증명을 포함하지 않는다', () => {
    process.env.SEED_API_URL = 'http://user:never-log-me@localhost:3000/api'
    expect(() => requireLocalSeedTarget('SEED_API_URL', ['http:', 'https:'])).toThrow('루프백')
  })

  it('오류 메시지에 URL이나 비밀번호를 싣지 않는다', () => {
    process.env.DATABASE_URL = 'postgresql://user:never-log-me@remote.example.test/demo'
    expect(() => requireLocalSeedTarget('DATABASE_URL', ['postgresql:'])).toThrow('루프백')
    try {
      requireLocalSeedTarget('DATABASE_URL', ['postgresql:'])
    } catch (error) {
      expect((error as Error).message).not.toContain('never-log-me')
      expect((error as Error).message).not.toContain('remote.example.test')
    }
  })
})
