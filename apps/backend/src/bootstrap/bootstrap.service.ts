import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LLM_PROVIDERS, type BootstrapPayload } from '@hermes/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SecretsService } from '../secrets/secrets.service';
import { bootstrapTokenMatches, generateBootstrapToken } from '../deploys/bootstrap-token';
import { normalizeIp } from './client-ip';
import { renderComposeFile, renderConfigYaml, renderEnvFile } from '../provisioning/hermes-config';

@Injectable()
export class BootstrapService {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
  ) {}

  /**
   * One-time secret pull for a freshly-installed VPS. Verifies the bootstrap
   * token (hash), single-use, and that the caller IP matches the recorded VM IP,
   * then burns the token and returns the rendered Hermes files + webhook secret.
   */
  async pull(deployId: string, token: string, callerIp: string | null): Promise<BootstrapPayload> {
    const deploy = await this.prisma.deploy.findUnique({ where: { id: deployId } });

    // 404 for anything that could be a probe: unknown id, wrong/used token.
    if (!deploy || !token || !bootstrapTokenMatches(token, deploy.bootstrap_token_hash)) {
      throw new NotFoundException('Unknown or invalid bootstrap token');
    }
    if (deploy.bootstrap_used_at) {
      throw new NotFoundException('Bootstrap token already used');
    }

    // IP check — the caller must be the provisioned VM (IP recorded by the worker).
    if (!deploy.vm_ip || !callerIp || normalizeIp(deploy.vm_ip) !== callerIp) {
      this.logger.warn(`Bootstrap IP mismatch for ${deployId}: caller=${callerIp ?? 'unknown'}`);
      throw new ForbiddenException('Caller IP does not match the VM');
    }

    const provider = LLM_PROVIDERS.find((p) => p.id === deploy.llm_provider);
    if (!provider) {
      throw new NotFoundException('Unknown LLM provider for this deploy');
    }

    // One-time webhook secret returned to the VPS and hashed at rest (Task 13).
    const webhook = generateBootstrapToken();

    // Atomic burn: only the first caller with an unused token wins the update.
    const burned = await this.prisma.deploy.updateMany({
      where: { id: deployId, bootstrap_used_at: null },
      data: { bootstrap_used_at: new Date(), webhook_secret_hash: webhook.hash },
    });
    if (burned.count !== 1) {
      throw new NotFoundException('Bootstrap token already used');
    }

    const env = renderEnvFile({
      botToken: this.secrets.decrypt(deploy.bot_token_enc),
      allowedUserId: deploy.user_id.toString(),
      keyEnv: provider.key_env,
      llmKey: this.secrets.decrypt(deploy.llm_key_enc),
    });
    const config_yaml = renderConfigYaml({
      provider: provider.id,
      baseUrl: deploy.llm_base_url ?? provider.base_url,
      keyEnv: provider.key_env,
      model: deploy.llm_model ?? provider.default_model,
    });
    const compose = renderComposeFile();

    this.logger.log(`Bootstrap secrets delivered for ${deployId}`);
    return { env, config_yaml, compose, webhook_secret: webhook.token };
  }
}
