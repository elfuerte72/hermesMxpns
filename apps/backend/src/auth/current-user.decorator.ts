import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TMA_USER_KEY, type RequestWithTmaUser } from './tma-auth.guard';
import type { AuthenticatedUser } from '@hermes/shared';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<RequestWithTmaUser>();
    const user = request[TMA_USER_KEY];
    if (!user) {
      throw new Error('CurrentUser used without TmaAuthGuard');
    }
    return user;
  },
);
