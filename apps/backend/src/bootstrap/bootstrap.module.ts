import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { SecretsModule } from '../secrets/secrets.module';
import { SecretsService } from '../secrets/secrets.service';
import { BootstrapController } from './bootstrap.controller';
import { BootstrapService } from './bootstrap.service';

@Module({
  imports: [PrismaModule, SecretsModule],
  controllers: [BootstrapController],
  providers: [
    {
      provide: BootstrapService,
      inject: [PrismaService, SecretsService],
      useFactory: (prisma: PrismaService, secrets: SecretsService) =>
        new BootstrapService(prisma, secrets),
    },
  ],
})
export class BootstrapModule {}
