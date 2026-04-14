export interface AuditEntry {
  id: string
  adminId: string
  action: string
  targetId: string | null
  detail: Record<string, unknown> | null
  createdAt: Date
}

export interface AuditLogRepositoryPort {
  create(adminId: string, action: string, targetId?: string, detail?: Record<string, unknown>): Promise<void>
  findAll(options: { page?: number; limit?: number; action?: string }): Promise<{ items: AuditEntry[]; total: number }>
}
