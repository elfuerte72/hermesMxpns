import { Controller, Get } from '@nestjs/common';
import type { LlmProvider } from '@hermes/shared';
import { LlmProvidersService } from './llm-providers.service';

@Controller('llm-providers')
export class LlmProvidersController {
  constructor(private readonly llmProvidersService: LlmProvidersService) {}

  @Get()
  list(): LlmProvider[] {
    return this.llmProvidersService.list();
  }
}
