import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser, CreateDeployResponse, DeployView } from '@hermes/shared';
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
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createDeploySchema)) dto: CreateDeployDto,
  ): Promise<CreateDeployResponse> {
    return this.deploysService.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<DeployView[]> {
    return this.deploysService.list(user);
  }

  @Get(':id')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DeployView> {
    return this.deploysService.getById(user, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.ACCEPTED)
  teardown(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DeployView> {
    return this.deploysService.requestTeardown(user, id);
  }
}
