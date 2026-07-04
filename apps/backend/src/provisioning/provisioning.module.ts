import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProvisioningService } from './provisioning.service';

@Module({
  providers: [
    {
      provide: ProvisioningService,
      useFactory: (config: ConfigService) => {
        const token = config.getOrThrow<string>('HOSTINGER_API_TOKEN');
        return new ProvisioningService(token);
      },
      inject: [ConfigService],
    },
  ],
  exports: [ProvisioningService],
})
export class ProvisioningModule {}
