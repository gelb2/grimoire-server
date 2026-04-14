export interface AuthTokenRepositoryPort {
  create(authorId: string, tokenHash: string, expiresAt: Date): Promise<void>
  findByHash(tokenHash: string): Promise<{ id: string; authorId: string; expiresAt: Date; revokedAt: Date | null } | null>
  revoke(id: string): Promise<void>
  revokeByHash(tokenHash: string): Promise<void>
  revokeAllByAuthorId(authorId: string): Promise<void>
}
