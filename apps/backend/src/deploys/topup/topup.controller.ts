import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser, TopupResponse, TopupTierView } from '@hermes/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { TmaAuthGuard } from '../../auth/tma-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { TopupService } from './topup.service';
import { topupSchema, type TopupDto } from './topup.dto';

@Controller('deploys')
@UseGuards(TmaAuthGuard)
export class TopupController {
  constructor(private readonly topupService: TopupService) {}

  /** Configured topup tiers (token amount + user-facing price + subscribe link). */
  @Get('topup/tiers')
  tiers(): TopupTierView[] {
    return this.topupService.listTiers();
  }

  /** Raise the managed key's spend cap after the user paid for a tier in @tribute. */
  @Post('topup')
  @HttpCode(HttpStatus.OK)
  topup(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(topupSchema)) dto: TopupDto,
  ): Promise<TopupResponse> {
    return this.topupService.topup(user, dto);
  }
}
