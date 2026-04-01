import { IsString, IsOptional, MinLength, IsIn } from 'class-validator'

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
