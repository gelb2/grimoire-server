/**
 * 텍스트 청킹 모듈 (YECHANGPE에서 이식)
 * 소설 도메인에 맞게 청크 크기를 800자로 조정
 */

const DEFAULT_CHUNK_SIZE = 800
const DEFAULT_OVERLAP = 100

export interface TextChunk {
  index: number
  text: string
}

export function chunkText(
  text: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_OVERLAP,
): TextChunk[] {
  if (!text || text.trim().length === 0) return []

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  if (normalized.length <= chunkSize) {
    return [{ index: 0, text: normalized.trim() }]
  }

  const chunks: TextChunk[] = []
  let start = 0
  let index = 0

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length)

    if (end < normalized.length) {
      const segment = normalized.slice(start, end)
      const lastParagraph = segment.lastIndexOf('\n\n')
      if (lastParagraph > chunkSize * 0.5) {
        end = start + lastParagraph + 2
      } else {
        const lastSentence = findLastSentenceBreak(segment)
        if (lastSentence > chunkSize * 0.5) {
          end = start + lastSentence
        } else {
          const lastNewline = segment.lastIndexOf('\n')
          if (lastNewline > chunkSize * 0.5) {
            end = start + lastNewline + 1
          }
        }
      }
    }

    const chunkContent = normalized.slice(start, end).trim()
    if (chunkContent.length > 0) {
      chunks.push({ index, text: chunkContent })
      index++
    }

    if (end >= normalized.length) break
    const prevStart = start
    start = end - overlap
    if (start <= prevStart) start = end
  }

  return chunks
}

function findLastSentenceBreak(text: string): number {
  const sentenceEnders = /[.!?。！？]\s/g
  let lastIndex = -1
  let match
  while ((match = sentenceEnders.exec(text)) !== null) {
    lastIndex = match.index + match[0].length
  }
  return lastIndex
}
