import { IsString, IsNotEmpty, MinLength } from 'class-validator'

export class GenerateThemeDto {
  @IsString()
  @IsNotEmpty()
  authorId!: string

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  description!: string
}
