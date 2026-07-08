import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OPENROUTER_API_BASE } from '@hermes/shared';
import { OpenRouterKeysService } from './openrouter-keys.service';

@Module({
  providers: [
    {
      provide: OpenRouterKeysService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const managementKey = config.get<string>('OPENROUTER_MANAGEMENT_KEY') ?? null;
        return new OpenRouterKeysService(managementKey, OPENROUTER_API_BASE);
      },
    },
  ],
  exports: [OpenRouterKeysService],
})
export class OpenRouterKeysModule {}
