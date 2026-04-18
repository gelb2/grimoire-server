// lib/rag — 순수 유틸리티만 export
// 외부 API 호출(임베딩, 벡터DB)은 adapter/outbound/ 계층에서 처리
export { chunkText, type TextChunk } from './chunker'
export { checkConsistency, checkTone, checkCharacter, type AnalysisResult, type AskFn, type WorkMeta } from './novel-analyzer'
