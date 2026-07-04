import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { ValidateBotTokenController } from './validate-bot-token.controller';
import { TELEGRAM_API_BASE, ValidateBotTokenService } from './validate-bot-token.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ValidateBotTokenController],
  providers: [
    {
      provide: ValidateBotTokenService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new ValidateBotTokenService(prisma, TELEGRAM_API_BASE),
    },
  ],
})
export class DeploysModule {}
