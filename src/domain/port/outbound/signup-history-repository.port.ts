export interface SignupHistoryRepositoryPort {
  findByProviderId(providerId: string): Promise<{ signupCount: number } | null>
  upsert(providerId: string): Promise<void>
}
