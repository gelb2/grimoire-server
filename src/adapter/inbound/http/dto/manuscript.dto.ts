import { IsString, IsNotEmpty } from 'class-validator'

export class ParseManuscriptDto {
  @IsString()
  @IsNotEmpty()
  mdText!: string
}
