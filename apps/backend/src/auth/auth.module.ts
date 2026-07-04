import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthController } from './auth.controller';
import { AuthService, DEFAULT_AUTH_MAX_AGE_SECONDS } from './auth.service';
import { TmaAuthGuard } from './tma-auth.guard';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    {
      provide: AuthService,
      inject: [PrismaService, ConfigService],
      useFactory: (prisma: PrismaService, config: ConfigService) => {
        const botToken = config.get<string>('BOT_TOKEN') ?? '';
        const maxAge = config.get<number>('TMA_AUTH_MAX_AGE_SECONDS') ?? DEFAULT_AUTH_MAX_AGE_SECONDS;
        return new AuthService(prisma, botToken, maxAge);
      },
    },
    TmaAuthGuard,
  ],
  exports: [AuthService, TmaAuthGuard],
})
export class AuthModule {}
