import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { DeployReadyResponse } from '@hermes/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { WebhooksService } from './webhooks.service';
import { deployReadySchema, parseBearer, type DeployReadyDto } from './deploy-ready.dto';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('deploy-ready')
  @HttpCode(HttpStatus.OK)
  deployReady(
    @Body(new ZodValidationPipe(deployReadySchema)) dto: DeployReadyDto,
    @Headers('authorization') authorization?: string,
  ): Promise<DeployReadyResponse> {
    return this.webhooksService.deployReady(dto.deploy_id, parseBearer(authorization));
  }
}
