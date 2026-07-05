import { useEffect, useState, type ReactElement } from 'react';
import type { CreateDeployRequest, LlmProvider } from '@hermes/shared';
import { createDeploy, fetchProviders, validateLlmKey } from '../api';
import { errorMessage, llmKeyErrorMessage } from '../error-messages';
import { BackLink, PixelButton, PixelInput, StepLine } from './ui';

interface ProviderStepProps {
  botToken: string;
  onBack: () => void;
  onDeployed: (deployId: string) => void;
}

const PROVIDER_META: Record<string, { label: string; note: string }> = {
  groq: { label: 'GROQ', note: 'бесплатно · без карты' },
  proxyapi: { label: 'PROXYAPI', note: 'рубли · карта МИР' },
  vsegpt: { label: 'VSEGPT', note: 'рубли' },
  openrouter: { label: 'OPENROUTER', note: 'зарубежная карта' },
  custom: { label: 'СВОЙ API', note: 'OpenAI-compatible' },
};

function providerMeta(p: LlmProvider): { label: string; note: string } {
  return PROVIDER_META[p.id] ?? { label: p.id.toUpperCase(), note: p.name };
}

export function ProviderStep({ botToken, onBack, onDeployed }: ProviderStepProps): ReactElement {
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [providerId, setProviderId] = useState('');
  const [llmKey, setLlmKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [llmKeyOk, setLlmKeyOk] = useState(false);
  const [checkingKey, setCheckingKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProviders()
      .then(setProviders)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  const provider = providers.find((p) => p.id === providerId);
  const isCustom = providerId === 'custom';
  const needsModel = provider ? provider.default_model === '' : isCustom;
  const fieldsFilled =
    llmKey.trim().length > 0 &&
    providerId.length > 0 &&
    (!isCustom || baseUrl.trim().length > 0) &&
    (!needsModel || model.trim().length > 0);
  const canCheckKey = fieldsFilled && !checkingKey;
  const canSubmit = botToken.trim().length > 0 && fieldsFilled && llmKeyOk && !submitting;

  function selectProvider(id: string): void {
    setProviderId(id);
    setLlmKeyOk(false);
    setError(null);
  }

  async function handleValidateLlmKey(): Promise<void> {
    setCheckingKey(true);
    setError(null);
    setLlmKeyOk(false);
    try {
      await validateLlmKey({
        provider_id: providerId,
        api_key: llmKey.trim(),
        ...(isCustom ? { base_url: baseUrl.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
      });
      setLlmKeyOk(true);
    } catch (err) {
      setError(llmKeyErrorMessage(err));
    } finally {
      setCheckingKey(false);
    }
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const body: CreateDeployRequest = {
        bot_token: botToken.trim(),
        llm_provider: providerId,
        llm_key: llmKey.trim(),
        ...(isCustom ? { llm_base_url: baseUrl.trim() } : {}),
        ...(model.trim() ? { llm_model: model.trim() } : {}),
      };
      const { deploy_id } = await createDeploy(body);
      onDeployed(deploy_id);
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <section className="flex flex-1 flex-col gap-5">
      <BackLink label="◄ ШАГ 1" onClick={onBack} />
      <StepLine step="ШАГ 2" title="/ 2 — МОЗГ АГЕНТА" />
      <h2 className="text-sm tracking-wide uppercase">Выбери ИИ-провайдера</h2>

      <div className="flex flex-col gap-2.5">
        {providers.map((p) => {
          const meta = providerMeta(p);
          const selected = p.id === providerId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => selectProvider(p.id)}
              className={`flex items-center justify-between gap-2 border-2 p-3.5 text-left text-[10px] ${
                selected ? 'border-accent' : 'border-edge'
              }`}
            >
              <span>
                {selected && <span className="text-accent">► </span>}
                {meta.label}
              </span>
              <span className="text-right text-[9px] text-dim">{meta.note}</span>
            </button>
          );
        })}
      </div>

      {providerId && (
        <>
          {isCustom && (
            <PixelInput
              type="url"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setLlmKeyOk(false);
              }}
              placeholder="https://api.example.com/v1"
            />
          )}
          {needsModel && (
            <PixelInput
              type="text"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                setLlmKeyOk(false);
              }}
              placeholder="openai/gpt-4o-mini"
            />
          )}
          <PixelInput
            type="password"
            value={llmKey}
            onChange={(e) => {
              setLlmKey(e.target.value);
              setLlmKeyOk(false);
            }}
            placeholder={`Вставь API-ключ ${provider ? providerMeta(provider).label : ''}…`}
          />
          {llmKeyOk && (
            <p className="text-[8px] tracking-wide text-ok">✓ ключ рабочий · модель отвечает</p>
          )}
        </>
      )}

      {error && <p className="text-[8px] tracking-wide text-red-400">{error}</p>}

      <div className="mt-auto flex flex-col gap-2.5 pb-3">
        {llmKeyOk ? (
          <PixelButton variant="accent" disabled={!canSubmit} onClick={() => void handleSubmit()}>
            {submitting ? 'Запускаем…' : '🚀 Запустить деплой'}
          </PixelButton>
        ) : (
          <PixelButton
            variant="accent"
            disabled={!canCheckKey}
            onClick={() => void handleValidateLlmKey()}
          >
            {checkingKey ? 'Проверяем…' : 'Проверить ключ'}
          </PixelButton>
        )}
        <p className="text-center text-[8px] tracking-wide text-dim">
          спишется после успешного запуска · отмена в один клик
        </p>
      </div>
    </section>
  );
}
