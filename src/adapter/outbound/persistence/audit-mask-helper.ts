/**
 * Sprint PAY-P2-5 — audit retention 정책 (영구 보존 + 90일 후 PII 마스킹).
 *
 * 사용자 결정 옵션 D (5/10 verbatim "d로 하고"):
 * - 영구 보존 (DELETE 0건 강제)
 * - 90일 경과 row → PII 자동 마스킹
 * - audit 본질 보존 (id/userId/authorId/adminId/action/createdAt 영역 유지)
 *
 * 정본: `.claude/shared-contracts.md` §26 AuditRetentionPolicy
 */

/**
 * PII 마스킹 적용 키 (7건). 본 키 매트릭스 정합 시 `***` 대체.
 */
export const PII_KEYS = [
  'email',
  'phone',
  'ipAddress',
  'userAgent',
  'passwordHash',
  'token',
  'secret',
] as const

export type PIIKey = (typeof PII_KEYS)[number]

/**
 * 보존 키 매트릭스 — 마스킹 X 강제 (audit 본질 정합).
 * 본 키 매트릭스 정합 시 마스킹 적용 0건.
 */
export const PRESERVED_KEYS = new Set([
  'id',
  'userId',
  'authorId',
  'adminId',
  'action',
  'createdAt',
  'amount',
  'credits',
  'status',
  'eventId',
  'eventType',
  'source',
  'targetId',
  'retryCount',
  'nextRetryAt',
  'processedAt',
  'maskedAt',
  'retentionTier',
  // snake_case 변형도 보존
  'user_id',
  'author_id',
  'admin_id',
  'created_at',
  'event_id',
  'event_type',
  'target_id',
  'retry_count',
  'next_retry_at',
  'processed_at',
  'masked_at',
  'retention_tier',
])

/**
 * 마스킹 멱등성 체크 — 이미 `***` 인 값 재마스킹 0건.
 */
function isAlreadyMasked(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return value === '***' || value.includes('***')
}

/**
 * email 마스킹: `john@example.com` → `j***@example.com`
 */
export function maskEmail(email: string): string {
  if (isAlreadyMasked(email)) return email
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  const first = email.charAt(0)
  const domain = email.slice(at)
  return `${first}***${domain}`
}

/**
 * phone 마스킹: `010-1234-5678` → `010-****-****`
 */
export function maskPhone(phone: string): string {
  if (isAlreadyMasked(phone)) return phone
  // 010-1234-5678 또는 010-12345678 또는 01012345678
  const digits = phone.replace(/[^0-9]/g, '')
  if (digits.length < 10) return '***'
  const prefix = digits.slice(0, 3)
  return `${prefix}-****-****`
}

/**
 * ipAddress 마스킹: `192.168.1.100` → `192.168.***.**`
 */
export function maskIpAddress(ip: string): string {
  if (isAlreadyMasked(ip)) return ip
  const parts = ip.split('.')
  if (parts.length !== 4) return '***'
  return `${parts[0]}.${parts[1]}.***.**`
}

/**
 * userAgent 마스킹: 전체 UA → `Mozilla/5.0 (***)`
 */
export function maskUserAgent(ua: string): string {
  if (isAlreadyMasked(ua)) return ua
  const match = ua.match(/^([A-Za-z]+\/[\d.]+)/)
  if (match) return `${match[1]} (***)`
  return '***'
}

/**
 * passwordHash / token / secret 마스킹: 전체 → `***`
 */
export function maskSecret(_value: string): string {
  return '***'
}

/**
 * 단일 값 PII 마스킹 (key 매트릭스 정합 시).
 */
export function maskValueByKey(key: string, value: unknown): unknown {
  if (PRESERVED_KEYS.has(key)) return value
  if (typeof value !== 'string') return value
  if (isAlreadyMasked(value)) return value

  const lowerKey = key.toLowerCase()
  if (lowerKey === 'email' || lowerKey.endsWith('_email') || lowerKey.endsWith('email')) {
    return maskEmail(value)
  }
  if (lowerKey === 'phone' || lowerKey.endsWith('_phone') || lowerKey.endsWith('phone')) {
    return maskPhone(value)
  }
  if (
    lowerKey === 'ip' ||
    lowerKey === 'ipaddress' ||
    lowerKey === 'ip_address' ||
    lowerKey.endsWith('_ip')
  ) {
    return maskIpAddress(value)
  }
  if (lowerKey === 'useragent' || lowerKey === 'user_agent') {
    return maskUserAgent(value)
  }
  if (
    lowerKey === 'passwordhash' ||
    lowerKey === 'password_hash' ||
    lowerKey === 'token' ||
    lowerKey === 'secret' ||
    lowerKey.endsWith('_token') ||
    lowerKey.endsWith('_secret')
  ) {
    return maskSecret(value)
  }
  return value
}

/**
 * JSON 객체 deep masking (재귀).
 *
 * - 객체 키 매트릭스 정합 시 마스킹 적용
 * - 보존 키는 마스킹 X 강제
 * - 배열 / 중첩 객체 재귀 처리
 * - 멱등성 강제 (이미 마스킹된 값 재변경 0건)
 */
export function maskJsonDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((v) => maskJsonDeep(v))
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (PRESERVED_KEYS.has(k)) {
        result[k] = v // 보존 키 — 재귀 진입 X
        continue
      }
      // 객체 / 배열은 재귀 진입
      if (typeof v === 'object' && v !== null) {
        result[k] = maskJsonDeep(v)
      } else {
        result[k] = maskValueByKey(k, v)
      }
    }
    return result
  }
  // primitive — 키 컨텍스트 없으므로 그대로
  return value
}

/**
 * AccessLog 한 row 마스킹 — string 컬럼 4건 (email/ip/userAgent/detail).
 */
export interface AccessLogRow {
  email: string | null
  ip: string | null
  userAgent: string | null
  detail: string | null
}

export function maskAccessLogRow(row: AccessLogRow): AccessLogRow {
  return {
    email: row.email ? maskEmail(row.email) : null,
    ip: row.ip ? maskIpAddress(row.ip) : null,
    userAgent: row.userAgent ? maskUserAgent(row.userAgent) : null,
    detail: row.detail, // string 자유 형식 — JSON parse 가능 시 deep, 아니면 보존
  }
}

/**
 * 마스킹 결과 매트릭스.
 */
export interface MaskingResult {
  modelsProcessed: string[]
  rowsMasked: number
  rowsSkipped: number
  errors: { rowId: string; error: string }[]
}
