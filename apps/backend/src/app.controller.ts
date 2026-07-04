import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import type { AppInfo } from '@hermes/shared';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getInfo(): AppInfo {
    return this.appService.getInfo();
  }

  @Get('health')
  getHealth(): { status: string } {
    return { status: 'ok' };
  }

  @Get('health/db')
  async getDbHealth(): Promise<{ status: string; users: number }> {
    const users = await this.prisma.user.count();
    return { status: 'ok', users };
  }
}
