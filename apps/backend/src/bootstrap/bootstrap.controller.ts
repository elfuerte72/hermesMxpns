import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { BootstrapPayload } from '@hermes/shared';
import { BootstrapService } from './bootstrap.service';
import { resolveClientIp } from './client-ip';

@Controller('bootstrap')
export class BootstrapController {
  constructor(private readonly bootstrapService: BootstrapService) {}

  @Get(':deployId')
  pull(
    @Param('deployId') deployId: string,
    @Query('token') token: string | undefined,
    @Req() req: Request,
  ): Promise<BootstrapPayload> {
    return this.bootstrapService.pull(deployId, token ?? '', resolveClientIp(req));
  }
}
