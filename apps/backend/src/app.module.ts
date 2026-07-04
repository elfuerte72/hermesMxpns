import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProvisioningModule } from './provisioning/provisioning.module';
import { SecretsModule } from './secrets/secrets.module';

@Module({
  imports: [ConfigModule, PrismaModule, SecretsModule, ProvisioningModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
