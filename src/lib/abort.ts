/**
 * 클라이언트 disconnect 대응용 Promise 중단 유틸.
 *
 * NestJS 기본 동작: 클라이언트가 HTTP abort 해도 Node.js 이벤트 루프의
 * Promise 체인은 끝까지 실행된다. `analyzeNewEpisode`처럼 외부 AI 호출을
 * 동반한 크레딧 차감 작업은, abort 후 서버가 성공으로 완료되면 환불 분기
 * (catch)를 타지 않아 사용자 크레딧이 차감된 상태로 끝난다.
 *
 * `abortableRace`는 signal abort 즉시 AbortedError를 reject 해 호출자의 catch
 * 블록이 확실히 실행되도록 한다. 이면의 실제 AI 호출은 끝까지 돌아 토큰
 * 비용은 회수되지 않지만(추후 SDK signal 전파로 개선 예정), 크레딧 환불은
 * 보장된다.
 */

export class AbortedError extends Error {
  constructor(message = '요청이 클라이언트에서 중단되었습니다') {
    super(message)
    this.name = 'AbortedError'
  }
}

export function isAborted(err: unknown): err is AbortedError {
  return err instanceof Error && (err.name === 'AbortedError' || err.name === 'AbortError')
}

/**
 * signal이 abort되면 promise 결과를 기다리지 않고 즉시 AbortedError로 reject.
 * signal이 undefined이거나 aborted 아니면 promise를 그대로 통과.
 */
export function abortableRace<T>(signal: AbortSignal | undefined, promise: Promise<T>): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new AbortedError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AbortedError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) },
    )
  })
}

/** signal이 이미 aborted면 즉시 throw. 각 단계 진입 시 가드로 사용. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AbortedError()
}
