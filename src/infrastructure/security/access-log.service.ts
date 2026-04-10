import { Injectable } from '@nestjs/common'
import { PrismaService } from '@infrastructure/prisma/prisma.service'

/** 보안 접근 로그 — 회원가입, 로그인, 비밀번호 변경 시 IP/UA 기록 */
@Injectable()
export class AccessLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(data: {
    action: string
    authorId?: string
    email?: string
    ip?: string
    userAgent?: string
    detail?: string
  }): Promise<void> {
    await this.prisma.accessLog.create({
      data: {
        action: data.action,
        authorId: data.authorId ?? null,
        email: data.email ?? null,
        ip: data.ip ?? null,
        userAgent: data.userAgent ?? null,
        detail: data.detail ?? null,
      },
    })
  }

  /** IP별 최근 로그인 실패 횟수 (brute-force 탐지용) */
  async countRecentFailures(ip: string, minutes: number = 15): Promise<number> {
    const since = new Date(Date.now() - minutes * 60 * 1000)
    return this.prisma.accessLog.count({
      where: {
        action: 'login_fail',
        ip,
        createdAt: { gte: since },
      },
    })
  }
}
