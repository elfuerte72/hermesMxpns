import { Controller, Get, Query } from '@nestjs/common';
import type { LlmProvider } from '@hermes/shared';
import { LlmProvidersService } from './llm-providers.service';

@Controller('llm-providers')
export class LlmProvidersController {
  constructor(private readonly llmProvidersService: LlmProvidersService) {}

  /** `openrouter` only by default; `?advanced=1` also reveals the BYOK `custom` provider. */
  @Get()
  list(@Query('advanced') advanced?: string): LlmProvider[] {
    return this.llmProvidersService.list(advanced === '1');
  }
}
