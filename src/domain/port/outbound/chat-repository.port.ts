export interface ChatSession {
  id: string
  authorId: string
  workId: string
  title: string
  createdAt: Date
  updatedAt: Date
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: Date
  // 크레딧 개편 I Phase (2026-05-17) — 토큰 실측 + 4구간 차감 박제 (assistant 메시지 — null=미차감)
  inputTokens?: number | null
  outputTokens?: number | null
  model?: string | null
  chargedPoints?: number | null
  chargeTier?: string | null
}

/**
 * 크레딧 개편 I Phase (2026-05-17) — assistant 메시지 토큰/차감 메타.
 * §8-8 CRITICAL #3 — 토큰 실측 필드 없이 차감 구현 금지.
 */
export interface ChatMessageTokenMeta {
  inputTokens: number
  outputTokens: number
  model: string
  /** 4구간 차감 포인트 (사후 차감 결과 — 미차감 시 생략) */
  chargedPoints?: number
  /** 차감 구간 'short'|'normal'|'long'|'xlong' (미차감 시 생략) */
  chargeTier?: string
}

export interface ChatRepositoryPort {
  createSession(authorId: string, workId: string, title?: string): Promise<ChatSession>
  findSessionsByAuthorAndWork(authorId: string, workId: string): Promise<ChatSession[]>
  findSessionById(id: string): Promise<ChatSession | null>
  deleteSession(id: string): Promise<void>
  updateSessionTitle(id: string, title: string): Promise<ChatSession>

  /**
   * 메시지 추가.
   * @param tokenMeta 크레딧 개편 I Phase — assistant 메시지 토큰 usage + 차감 메타 (옵션)
   */
  addMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    tokenMeta?: ChatMessageTokenMeta,
  ): Promise<ChatMessage>
  /**
   * 크레딧 개편 I Phase — 메시지의 차감 결과(chargedPoints/chargeTier) 사후 갱신.
   * 사후 차감 구조 — addMessage 후 차감이 확정되면 호출.
   */
  updateMessageCharge(
    messageId: string,
    chargedPoints: number,
    chargeTier: string,
  ): Promise<void>
  /** 커서 기반 페이지네이션 — cursor 이전 메시지를 limit개 반환 (최신순 → 역순 정렬) */
  getMessages(sessionId: string, limit: number, cursor?: string): Promise<ChatMessage[]>
  getRecentMessages(sessionId: string, limit: number): Promise<ChatMessage[]>

  /** 특정 시각 이후 업데이트된 세션 ID+workId 조회 (메모리 재생성용) */
  findActiveSessionsSince(since: Date): Promise<{ id: string; workId: string }[]>
  /** 특정 작품의 세션 ID 목록 조회 */
  findSessionIdsByWorkId(workId: string): Promise<string[]>
}
