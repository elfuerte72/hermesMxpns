import { Injectable } from '@nestjs/common';
import { LLM_PROVIDERS, type LlmProvider } from '@hermes/shared';

/**
 * Catalog of LLM providers exposed to the Mini App (§23.4). The one-click
 * bundle only advertises `openrouter` (managed key from the operator). The
 * hidden BYOK `custom` provider is revealed only with `advanced=true`.
 */
@Injectable()
export class LlmProvidersService {
  list(advanced = false): LlmProvider[] {
    const ids = advanced ? ['openrouter', 'custom'] : ['openrouter'];
    return LLM_PROVIDERS.filter((p) => ids.includes(p.id)).map((p) => ({ ...p }));
  }

  /** Look up any provider by id (including BYOK `custom`), regardless of advertising. */
  find(id: string): LlmProvider | null {
    const provider = LLM_PROVIDERS.find((p) => p.id === id);
    return provider ? { ...provider } : null;
  }
}
