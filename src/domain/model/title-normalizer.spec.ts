import { normalizeTitle } from './title-normalizer'

describe('normalizeTitle', () => {
  it('언더스코어를 공백으로 치환한다', () => {
    expect(normalizeTitle('사슴악마_ep9_도리안그레이의초상_초고')).toBe(
      '사슴악마 ep9 도리안그레이의초상 초고',
    )
  })

  it('연속 언더스코어도 단일 공백으로 치환한다', () => {
    expect(normalizeTitle('foo___bar')).toBe('foo bar')
  })

  it('연속 공백을 단일 공백으로 정리한다', () => {
    expect(normalizeTitle('foo   bar    baz')).toBe('foo bar baz')
  })

  it('언더스코어 + 공백 혼합도 정리한다', () => {
    expect(normalizeTitle('foo_ _bar__ baz')).toBe('foo bar baz')
  })

  it('앞뒤 공백을 제거한다', () => {
    expect(normalizeTitle('  hello  ')).toBe('hello')
  })

  it('앞뒤 언더스코어도 제거된다', () => {
    expect(normalizeTitle('__hello__')).toBe('hello')
  })

  it('순수 한글 제목은 그대로 유지한다', () => {
    expect(normalizeTitle('선녀와 나무꾼: 숲속의 목격자')).toBe(
      '선녀와 나무꾼: 숲속의 목격자',
    )
  })

  it('em/en dash를 보존한다 (정당한 타이포그래피)', () => {
    expect(normalizeTitle('Ep 9. — 사슴 악마 유니버스')).toBe(
      'Ep 9. — 사슴 악마 유니버스',
    )
    expect(normalizeTitle('1장 – 시작')).toBe('1장 – 시작')
  })

  it('콜론/따옴표/괄호 등 일반 구두점은 건드리지 않는다', () => {
    expect(normalizeTitle('제1화 "도리안 그레이의 초상" (1890)')).toBe(
      '제1화 "도리안 그레이의 초상" (1890)',
    )
  })

  it('빈 문자열은 빈 문자열로 반환한다', () => {
    expect(normalizeTitle('')).toBe('')
  })

  it('공백만 있는 문자열은 빈 문자열로 반환한다', () => {
    expect(normalizeTitle('   ')).toBe('')
  })

  it('non-string 입력은 빈 문자열로 방어한다', () => {
    // 방어적 분기 (타입스크립트 이외 경로로 값이 들어올 수 있음)
    expect(normalizeTitle(undefined as unknown as string)).toBe('')
    expect(normalizeTitle(null as unknown as string)).toBe('')
  })

  it('idempotent — 두 번 적용해도 결과가 같다', () => {
    const raw = 'foo___bar baz_qux  '
    const once = normalizeTitle(raw)
    const twice = normalizeTitle(once)
    expect(twice).toBe(once)
  })
})
