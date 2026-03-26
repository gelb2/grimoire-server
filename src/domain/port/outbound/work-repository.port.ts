import { Work, Episode, EpisodeSummary } from '@domain/model/work'
import { Block } from '@domain/model/block'

export interface WorkRepositoryPort {
  findByAuthorSlug(authorSlug: string): Promise<Work[]>
  findByAuthorAndWorkSlug(authorSlug: string, workSlug: string): Promise<Work | null>
  findEpisodes(workId: string): Promise<EpisodeSummary[]>
  findEpisode(authorSlug: string, workSlug: string, episodeSlug: string): Promise<Episode | null>
  createWork(input: { authorId: string; slug: string; title: string; subtitle?: string; description?: string }): Promise<Work>
  createEpisode(input: {
    workId: string
    slug: string
    title: string
    subtitle?: string
    orderNum: number
    blocks: Block[]
    rawMd: string
  }): Promise<Episode>
  countByAuthorId(authorId: string): Promise<number>
}
