/** 시드는 명시한 localhost 대상에서만 실행한다. URL/자격증명을 오류에 싣지 않는다. */
export function requireLocalSeedTarget(key: string, protocols: readonly string[]): string {
  if (process.env.APP_ENV !== 'localhost') {
    throw new Error('시드는 APP_ENV=localhost에서만 실행할 수 있습니다')
  }
  const value = process.env[key]
  let target: URL
  try {
    target = new URL(value ?? '')
  } catch {
    throw new Error(`${key}에 로컬 URL을 명시하세요`)
  }
  if (!protocols.includes(target.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
      (['http:', 'https:'].includes(target.protocol) && Boolean(target.username || target.password)) ||
      target.search || target.hash) {
    throw new Error(`${key}는 쿼리 없는 루프백 URL이어야 합니다`)
  }
  return value!
}
