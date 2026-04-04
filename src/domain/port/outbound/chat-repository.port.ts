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
}
