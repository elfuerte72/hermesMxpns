import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretsService } from './secrets.service';

@Module({
  providers: [
    {
      provide: SecretsService,
      useFactory: (config: ConfigService) => {
        const hex = config.getOrThrow<string>('ENCRYPTION_KEY');
        return new SecretsService(hex);
      },
      inject: [ConfigService],
    },
  ],
  exports: [SecretsService],
})
export class SecretsModule {}
