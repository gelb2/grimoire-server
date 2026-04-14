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
}

export interface ChatRepositoryPort {
  createSession(authorId: string, workId: string, title?: string): Promise<ChatSession>
  findSessionsByAuthorAndWork(authorId: string, workId: string): Promise<ChatSession[]>
  findSessionById(id: string): Promise<ChatSession | null>
  deleteSession(id: string): Promise<void>
  updateSessionTitle(id: string, title: string): Promise<ChatSession>

  addMessage(sessionId: string, role: 'user' | 'assistant', content: string): Promise<ChatMessage>
  /** 커서 기반 페이지네이션 — cursor 이전 메시지를 limit개 반환 (최신순 → 역순 정렬) */
  getMessages(sessionId: string, limit: number, cursor?: string): Promise<ChatMessage[]>
  getRecentMessages(sessionId: string, limit: number): Promise<ChatMessage[]>

  /** 특정 시각 이후 업데이트된 세션 ID+workId 조회 (메모리 재생성용) */
  findActiveSessionsSince(since: Date): Promise<{ id: string; workId: string }[]>
  /** 특정 작품의 세션 ID 목록 조회 */
  findSessionIdsByWorkId(workId: string): Promise<string[]>
}
