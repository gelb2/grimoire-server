import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { UpdateWorkDto } from './work.dto'

/**
 * F-5 — UpdateWorkDto 유효성 spec.
 *
 * 전역 ValidationPipe(whitelist + forbidNonWhitelisted)가 DTO metadata 를 강제하므로,
 * context/instructions whitelist 등재 + MaxLength 상한을 DTO 레벨에서 직접 검증한다.
 */
describe('UpdateWorkDto', () => {
  it('context/instructions 는 whitelist 등재 → 정상 통과', async () => {
    const dto = plainToInstance(UpdateWorkDto, {
      context: '세계관: 근미래 서울',
      instructions: '문체는 건조하게',
    })
    const errors = await validate(dto)
    expect(errors).toHaveLength(0)
  })

  it('context 가 상한(20000자) 초과면 MaxLength 위반 (→ 400)', async () => {
    const dto = plainToInstance(UpdateWorkDto, { context: 'a'.repeat(20001) })
    const errors = await validate(dto)
    expect(errors).toHaveLength(1)
    expect(errors[0].constraints).toHaveProperty('maxLength')
  })

  it('instructions 가 상한(5000자) 초과면 MaxLength 위반 (→ 400)', async () => {
    const dto = plainToInstance(UpdateWorkDto, { instructions: 'a'.repeat(5001) })
    const errors = await validate(dto)
    expect(errors).toHaveLength(1)
    expect(errors[0].constraints).toHaveProperty('maxLength')
  })

  it('상한 이내 context 는 통과', async () => {
    const dto = plainToInstance(UpdateWorkDto, { context: 'a'.repeat(20000) })
    const errors = await validate(dto)
    expect(errors).toHaveLength(0)
  })
})
