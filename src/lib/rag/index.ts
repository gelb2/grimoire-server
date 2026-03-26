export { chunkText, type TextChunk } from './chunker'
export { getEmbedding, getEmbeddingsBatch, EMBEDDING_DIM, EMBEDDING_MODEL } from './embeddings'
export { ensureVectorTable, insertChunk, searchSimilarChunks, deleteChunksByWork, deleteChunksByEpisode, getChunkCountByWork } from './vector-db'
export { checkConsistency, checkTone, checkCharacter, type AnalysisResult } from './novel-analyzer'
