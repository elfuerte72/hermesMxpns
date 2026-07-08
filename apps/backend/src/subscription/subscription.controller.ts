import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser, SubscriptionStatusResponse } from '@hermes/shared';
import { TmaAuthGuard } from '../auth/tma-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SubscriptionService } from './subscription.service';

@Controller('subscription')
@UseGuards(TmaAuthGuard)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  /** Cached subscription status (no live Telegram call). */
  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser): Promise<SubscriptionStatusResponse> {
    return this.subscriptionService.getStatus(user);
  }

  /** Force a live `getChatMember` check and refresh the cached status. */
  @Post('check')
  @HttpCode(HttpStatus.OK)
  check(@CurrentUser() user: AuthenticatedUser): Promise<SubscriptionStatusResponse> {
    return this.subscriptionService.checkStatus(user);
  }
}
