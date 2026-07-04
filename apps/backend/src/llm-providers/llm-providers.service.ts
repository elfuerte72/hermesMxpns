import { Injectable } from '@nestjs/common';
import { LLM_PROVIDERS, type LlmProvider } from '@hermes/shared';

@Injectable()
export class LlmProvidersService {
  list(): LlmProvider[] {
    return LLM_PROVIDERS.map((p) => ({ ...p }));
  }

  find(id: string): LlmProvider | null {
    const provider = LLM_PROVIDERS.find((p) => p.id === id);
    return provider ? { ...provider } : null;
  }
}
