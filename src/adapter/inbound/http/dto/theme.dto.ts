import { IsString, IsNotEmpty, IsOptional, MinLength } from 'class-validator'

export class GenerateThemeDto {
  @IsString()
  @IsNotEmpty()
  authorId!: string

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  description!: string

  @IsString()
  @IsOptional()
  name?: string
}
