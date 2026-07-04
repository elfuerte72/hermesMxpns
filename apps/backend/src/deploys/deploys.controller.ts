import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, UsePipes } from '@nestjs/common';
import type { AuthenticatedUser, CreateDeployResponse } from '@hermes/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TmaAuthGuard } from '../auth/tma-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DeploysService } from './deploys.service';
import { createDeploySchema, type CreateDeployDto } from './create-deploy.dto';

@Controller('deploys')
@UseGuards(TmaAuthGuard)
export class DeploysController {
  constructor(private readonly deploysService: DeploysService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UsePipes(new ZodValidationPipe(createDeploySchema))
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDeployDto,
  ): Promise<CreateDeployResponse> {
    return this.deploysService.create(user, dto);
  }
}
