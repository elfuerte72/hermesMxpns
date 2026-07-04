import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { parseTmaAuthHeader, type AuthenticatedUser } from '@hermes/shared';
import { AuthService } from './auth.service';

export const TMA_USER_KEY = 'tmaUser';

export interface RequestWithTmaUser {
  headers: Record<string, string | string[] | undefined>;
  [TMA_USER_KEY]?: AuthenticatedUser;
}

@Injectable()
export class TmaAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithTmaUser>();
    const authHeader = request.headers['authorization'];
    const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const initData = parseTmaAuthHeader(header);
    if (!initData) {
      throw new UnauthorizedException('Missing Telegram Mini App credentials');
    }
    try {
      request[TMA_USER_KEY] = this.authService.authenticate(initData);
      return true;
    } catch (err) {
      throw err instanceof UnauthorizedException
        ? err
        : new UnauthorizedException('Invalid Telegram Mini App credentials');
    }
  }
}
