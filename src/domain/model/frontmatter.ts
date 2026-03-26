/** MD 파일의 frontmatter 메타데이터 */
export interface Frontmatter {
  slug: string
  type: 'episode' | 'bonus' | 'preface' | 'afterword'
  num?: string
  subtitle?: string
  description?: string
}
