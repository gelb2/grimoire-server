import {
  IsEmail,
  IsString,
  MinLength,
  Matches,
  IsOptional,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  Validate,
} from 'class-validator'

export class RegisterDto {
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다' })
  email!: string

  @IsString()
  @MinLength(6, { message: '비밀번호는 6자 이상이어야 합니다' })
  password!: string

  @IsString()
  @MinLength(2, { message: '이름은 2자 이상이어야 합니다' })
  name!: string

  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: '슬러그는 영문 소문자, 숫자, 하이픈만 사용 가능합니다' })
  @MinLength(2, { message: '슬러그는 2자 이상이어야 합니다' })
  slug!: string
}

/**
 * email XOR slug 1택 강제 — EMAIL-P0-3 slug 로그인 마이그레이션
 *
 * 정책:
 * - email 박제 + slug 미박제 → 통과 (기존 email 로그인 후향호환)
 * - slug 박제 + email 미박제 → 통과 (신규 slug 로그인)
 * - 둘 다 박제 → BadRequest ("이메일 또는 슬러그 중 하나만 박제하세요")
 * - 둘 다 미박제 → BadRequest ("이메일 또는 슬러그가 필요합니다")
 */
@ValidatorConstraint({ name: 'EmailXorSlug', async: false })
export class EmailXorSlugConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as { email?: string; slug?: string }
    const hasEmail = typeof obj.email === 'string' && obj.email.length > 0
    const hasSlug = typeof obj.slug === 'string' && obj.slug.length > 0
    // XOR — 정확히 1개만 박제되어야 통과
    return (hasEmail && !hasSlug) || (!hasEmail && hasSlug)
  }

  defaultMessage(args: ValidationArguments): string {
    const obj = args.object as { email?: string; slug?: string }
    const hasEmail = typeof obj.email === 'string' && obj.email.length > 0
    const hasSlug = typeof obj.slug === 'string' && obj.slug.length > 0
    if (hasEmail && hasSlug) return '이메일 또는 슬러그 중 하나만 박제하세요'
    return '이메일 또는 슬러그가 필요합니다'
  }
}

export class LoginDto {
  // email XOR slug 1택 — 기존 email 로그인 후향호환 + 신규 slug 로그인
  @IsOptional()
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다' })
  email?: string

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: '슬러그는 영문 소문자, 숫자, 하이픈만 사용 가능합니다' })
  @MinLength(2, { message: '슬러그는 2자 이상이어야 합니다' })
  slug?: string

  @IsString()
  @MinLength(6, { message: '비밀번호는 6자 이상이어야 합니다' })
  password!: string

  // email XOR slug XOR validator — class-level 검증 (객체 전체 인자 평가)
  // 내부 더미 필드: 검증만 수행하고 응답에 노출 0건
  @Validate(EmailXorSlugConstraint)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __emailXorSlug?: any
}

/** EMAIL-POLAR-READY Phase C — 비밀번호 초기화 요청 DTO */
export class PasswordResetRequestDto {
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다' })
  email!: string
}

/** EMAIL-POLAR-READY Phase C — 토큰 검증 DTO (verify-email / password-reset 공유) */
export class TokenConfirmDto {
  @IsString()
  @MinLength(20, { message: '토큰이 유효하지 않습니다' })
  token!: string
}
