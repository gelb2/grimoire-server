import { IsString, IsOptional, MinLength, IsIn, MaxLength, IsArray, ArrayNotEmpty, ArrayMaxSize } from 'class-validator'

export class CreateWorkDto {
  @IsString() @MinLength(1) title!: string
  @IsString() @IsOptional() subtitle?: string
  @IsString() @IsOptional() description?: string
  @IsString() @MinLength(1) slug!: string
}

export class UpdateWorkDto {
  @IsString() @IsOptional() title?: string
  @IsString() @IsOptional() subtitle?: string
  @IsString() @IsOptional() description?: string
  // F-5 (2026-07-11) — 채팅 프로젝트 메모리(context)/작품 지침(instructions) 저장 경로.
  // 전역 forbidNonWhitelisted 로 인해 whitelist 누락 시 항상 400 이었다 → 필드 등재로 저장 관통.
  // context 는 채팅 시스템 프롬프트 주입원이므로 길이 상한 필수 (2026-05-30 works.context 오염
  // 사건 감안 — 무한 주입 차단 상한). 상한은 정상 누적 프로젝트 메모리엔 넉넉, 남용엔 천장.
  @IsString() @IsOptional() @MaxLength(20000) context?: string
  @IsString() @IsOptional() @MaxLength(5000) instructions?: string
}

export class CreateEpisodeDto {
  @IsString() @MinLength(1) title!: string
  @IsString() rawContent!: string
  @IsString() @IsOptional() sourceFormat?: string // 'markdown' | 'txt' | 'docx' | 'hwp' | 'hwpx'
}

export class UpdateEpisodeStatusDto {
  @IsString() @IsIn(['upload', 'public', 'nonPublic']) status!: 'upload' | 'public' | 'nonPublic'
}

export class CreateShareLinkDto {
  @IsString() @IsIn(['12h', '24h', '48h', 'never']) expireIn!: '12h' | '24h' | '48h' | 'never'
}

// F-20 (기획 §13) — 에피소드 순서 변경. episodeIds 는 새 순서대로 나열한 작품 전체 에피소드 id 배열.
// 집합 일치(개수/중복/소속) 검증은 UseCase 가 수행 — DTO 는 형태(비어있지 않은 문자열 배열)만 강제.
// ArrayMaxSize — 단일 작품 에피소드 상한(방어적) 초과 페이로드 차단.
export class ReorderEpisodesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  episodeIds!: string[]
}
