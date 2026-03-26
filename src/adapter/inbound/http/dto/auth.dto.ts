import { IsEmail, IsString, MinLength, Matches } from 'class-validator'

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

export class LoginDto {
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다' })
  email!: string

  @IsString()
  password!: string
}
