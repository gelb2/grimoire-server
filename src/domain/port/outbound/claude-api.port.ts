import { AuthorTheme } from '@domain/model/theme'

export interface ClaudeApiPort {
  generateTheme(description: string): Promise<AuthorTheme>
}
